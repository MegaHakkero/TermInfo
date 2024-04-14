/* terminfo.js - Terminfo database parser
 * Copyright (C) 2024  Marisa <private>
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import Enum from "./enum.js";
import Caps from "./caps.js";

import * as Errors from "./errors.js";

const Magic = Enum(
	["MAGIC",    0x011A],
	["MAGIC_32", 0x021E]
);

class Header {
	static size = 12; // 6 * i16

	constructor(magic, sizeNames, nCapBool, nCapNum, nCapStr, sizeStr) {
		this.magic     = Magic(magic);
		this.sizeNames = parseInt(sizeNames);
		this.nCapBool  = parseInt(nCapBool);
		this.nCapNum   = parseInt(nCapNum);
		this.nCapStr   = parseInt(nCapStr);
		this.sizeStr   = parseInt(sizeStr);
	}
}

class ExtendedHeader {
	static size = 10; // 5 * i16

	constructor(nCapBool, nCapNum, nCapStr, nStr, sizeStr) {
		this.nCapBool = parseInt(nCapBool);
		this.nCapNum  = parseInt(nCapNum);
		this.nCapStr  = parseInt(nCapStr);
		this.nStr     = parseInt(nStr);
		this.sizeStr  = parseInt(sizeStr);
	}
}

class TermName {
	constructor(str) {
		const s = str.split("|");
		this.brief = s[0];
		if (s.length < 2)
			return;
		this.detailed = s.at(-1);
		if (s.length < 3)
			return;
		this.synonyms = s.slice(1, -1);
	}
}

// exports
export class DB {
	#populate() {
		const db = ([...arguments].length < 1) ? this.path : arguments[0];
		// if arguments[0] is defined, then arguments[1] must also be defined
		const n  = ([...arguments].length < 1) ? undefined : arguments[1];

		if (Deno.statSync(db).isFile) {
			this.entries[n] = db;
			return;
		}
	
		for (const entry of Deno.readDirSync(db))
			this.#populate(db + "/" + entry.name, entry.name);
	}

	constructor(path) {
		if (!Deno.statSync(path).isDirectory)
			throw new TypeError("not a directory: " + path);

		this.path    = path;
		this.entries = {};

		this.#populate();
	}

	load(name) {
		if (Object.keys(this.entries).length < 1)
			throw new Errors.UninitializedError("Database not loaded");
		
		if (this.entries[name] === undefined)
			throw new TypeError(`Entry '${name}' does not exist in this database`);

		return new Entry(this.entries[name]);
	}

	loadDefault(fallback) {
		let t = Deno.env.get("TERM");
		if (t === undefined && fallback === undefined)
			throw new TypeError("$TERM is undefined and no fallback was provided");
		else if (t === undefined)
			t = fallback;
		return this.load(t);
	}
}

export class Entry {
	#file;
	#numWidth;

	#extBool;
	#extNum;
	#extStr;
	#extStrTable;
	#extStrOffsets;
	#extStrMissingTotal;

	#fileEnd() {
		return this.#file.seekSync(0, Deno.SeekMode.Current) >= this.#file.statSync().size;
	}

	#strictReadBytes(nbytes) {
		const data = new Uint8Array(nbytes);

		if (!data.length)
			return 0;

		if (this.#file.readSync(data) < data.byteLength)
			throw new Errors.FormatError("less than " + data.byteLength.toString() + " bytes read");

		return data;
	}

	#readHeader() {
		const data = this.#strictReadBytes(Header.size);
		const dv = new DataView(data.buffer);

		this.header = new Header(
			dv.getInt16(0,  true),
			dv.getInt16(2,  true),
			dv.getInt16(4,  true),
			dv.getInt16(6,  true),
			dv.getInt16(8,  true),
			dv.getInt16(10, true)
		);

		this.#numWidth = 2 + (this.header.magic.is("MAGIC_32") * 2);
	}

	#readTermNames() {
		const data = this.#strictReadBytes(this.header.sizeNames);

		// ignore null terminator
		this.names = new TermName(new TextDecoder().decode(data.subarray(0, -1)));
	}

	#readBooleans() {
		this.booleans = {};

		// consider padding according to term(5) (cc sakuya)
		const pad = (this.header.sizeNames + this.header.nCapBool) % 2;

		if (!this.header.nCapBool) {
			this.#file.seekSync(pad, Deno.SeekMode.Current);
			return;
		}

		const data = this.#strictReadBytes(this.header.nCapBool + pad);

		for (let i = 0; i < this.header.nCapBool; i++) {
			if (data[i])
				this.booleans[Caps.Booleans(i).key] = true;
		}
	}

	#readNumbers() {
		this.numbers = {};

		if (!this.header.nCapNum)
			return;

		const data = this.#strictReadBytes(this.header.nCapNum * this.#numWidth);
		const dv = new DataView(data.buffer);
		const read = (this.#numWidth === 4) ? dv.getInt32.bind(dv) : dv.getInt16.bind(dv);

		for (let i = 0; i < this.header.nCapNum; i++) {
			const cap = read(i * this.#numWidth, true);
			if (cap < 0)
				continue; // cap absent or CANCELED BY WOKE MORALISTS!!! (/j)
			this.numbers[Caps.Numbers(i).key] = cap;
		}
	}

	#readStrings() {
		this.strings = {};

		const pad = this.header.sizeStr % 2;

		if (!this.header.nCapStr) {
			this.#file.seekSync(pad, Deno.SeekMode.Current);
			return;
		}

		const offs = this.#strictReadBytes(this.header.nCapStr * 2);
		const data = this.#strictReadBytes(this.header.sizeStr);

		const dvOffsets = new DataView(offs.buffer);

		for (let i = 0; i < this.header.nCapStr; i++) {
			const off = dvOffsets.getInt16(i * 2, true);
			if (off < 0)
				continue; // absent (same MO as readNumbers)
			this.strings[Caps.Strings(i).key] =
				new TextDecoder().decode(data.slice(off, data.indexOf(0, off)));
		}

		// this skip needs to be conditional because the string section isn't
		// necessarily followed by more data
		if (pad && !this.#fileEnd())
			this.#file.seekSync(1, Deno.SeekMode.Current);
	}

	#readExtHeader() {
		const data = this.#strictReadBytes(ExtendedHeader.size);
		const dv   = new DataView(data.buffer);

		this.extHeader = new ExtendedHeader(
			dv.getInt16(0, true),
			dv.getInt16(2, true),
			dv.getInt16(4, true),
			dv.getInt16(6, true),
			dv.getInt16(8, true)
		);
	}

	#readExtBools() {
		this.#extBool = [];

		const pad = this.extHeader.nCapBool % 2;

		if (!this.extHeader.nCapBool) {
			this.#file.seekSync(pad, Deno.SeekMode.Current);
			return;
		}

		const data = this.#strictReadBytes(this.extHeader.nCapBool + pad);

		this.#extBool = Array.from(data.subarray(0, this.extHeader.nCapBool));
	}

	#readExtNums() {
		this.#extNum = [];

		if (!this.extHeader.nCapNum)
			return;

		const data = this.#strictReadBytes(this.extHeader.nCapNum * this.#numWidth);
		const dv   = new DataView(data.buffer);
		const read = (this.#numWidth === 4) ? dv.getInt32.bind(dv) : dv.getInt16.bind(dv);

		for (let i = 0; i < this.extHeader.nCapNum; i++)
			this.#extNum.push(read(i * this.#numWidth, true));
	}

	// SPELL CARD -- NCURSES BULLSHIT
	// the ncurses extended terminfo data is WORSE THAN HELL, even
	// though it's supposed to be _simpler_ as described by term(5)
	// than the basic format.
	// It's full of undocumented quirks I figured out by
	// trying to parse the entire database and randomly noticing
	// something wrong with one of the terminals.
	// I'd rather let utsuho reiuji rail me with her black hole
	// gun than look at this shit ever again.
	#readExtStrings() {
		this.#extStr = [];
		this.#extStrOffsets = [];
		this.#extStrMissingTotal = 0;

		if (!this.extHeader.nStr)
			return;
		
		let offs = this.#strictReadBytes(this.extHeader.nStr * 2);
		let dvOffsets = new DataView(offs.buffer);

		// some terminals (read: one that I know of) have missing
		// string capabilities (0xFFFF offset) in the extended
		// string offset table. these don't count towards nStr
		// indicated in the extended header, but they DO count
		// towards nCapStr.
		// it's unclear what this even brings to the table;
		// the extended data is dynamic, so there should be zero
		// need for marking a random capability as absent from the
		// file.
		// you could just remove it
		let nMissing, from = 0, to = this.extHeader.nStr;
		do {
			nMissing = 0;
			for (let i = from; i < to; i++) {
				const off = dvOffsets.getInt16(i * 2, true);
				this.#extStrOffsets.push(off);
				
				if (off >= 0)
					continue;

				nMissing++;
				this.#extStrMissingTotal++;
			}

			if (!nMissing)
				break;

			from = to;
			to += nMissing;

			// why is there no concat() for Uint8Array?
			const missing = this.#strictReadBytes(nMissing * 2);
			offs = Uint8Array.from(Array.from(offs).concat(Array.from(missing)));
			dvOffsets = new DataView(offs.buffer);
		} while (nMissing > 0);

		this.#extStrTable = this.#strictReadBytes(this.extHeader.sizeStr);
		
		let capsEnd = 0;
		for (let i = 0; i < this.extHeader.nCapStr; i++) {
			const off = this.#extStrOffsets[i];
			if (off < 0) {
				this.#extStr.push("ABSENT");
				continue;
			}
			capsEnd = this.#extStrTable.indexOf(0, off);
			this.#extStr.push(new TextDecoder().decode(
				this.#extStrTable.subarray(off, capsEnd)));
		}

		// align name offsets to start of string table to reduce
		// annoying math. surely *these* can't be absent?
		for (let i = this.extHeader.nCapStr; i < this.extHeader.nStr + this.#extStrMissingTotal; i++)
			this.#extStrOffsets[i] += capsEnd + 1;
	}

	#readExtNames() {
		let base = this.extHeader.nCapStr;

		for (let i = 0; i < this.extHeader.nCapBool; i++) {
			const off = this.#extStrOffsets[base + i];
			const end = this.#extStrTable.indexOf(0, off);
			this.booleans[new TextDecoder().decode(this.#extStrTable.subarray(off, end))] =
				!!this.#extBool[i];
		}
		base += this.extHeader.nCapBool;

		for (let i = 0; i < this.extHeader.nCapNum; i++) {
			const off = this.#extStrOffsets[base + i];
			const end = this.#extStrTable.indexOf(0, off);
			this.numbers[new TextDecoder().decode(this.#extStrTable.subarray(off, end))] =
				this.#extNum[i];
		}
		base += this.extHeader.nCapNum;

		for (let i = 0; i < this.extHeader.nCapStr; i++) {
			const off = this.#extStrOffsets[base + i];
			if (this.#extStrOffsets[i] < 0)
				continue; // ignore missing string caps
			const end = this.#extStrTable.indexOf(0, off);
			this.strings[new TextDecoder().decode(this.#extStrTable.subarray(off, end))] =
				this.#extStr[i];
		}
	}

	constructor(path) {
		this.path = path;
		this.#file = Deno.openSync(this.path);
		
		this.#readHeader();
		this.#readTermNames();
		this.#readBooleans();
		this.#readNumbers();
		this.#readStrings();
		
		if (this.#fileEnd()) {
			this.#file.close();
			return;
		}

		this.#readExtHeader();
		this.#readExtBools();
		this.#readExtNums();
		this.#readExtStrings();
		this.#readExtNames();

		this.#file.close();
	}

	is32bit() {
		return this.header.magic.is("MAGIC_32");
	}

	isExtended() {
		return this.extHeader !== undefined;
	}
}
