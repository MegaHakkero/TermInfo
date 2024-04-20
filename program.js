/* program.js - terminfo string compiler runtime and API
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

import * as Compiler from './compiler.js';
import * as TermInfo from './terminfo.js';

function print(s) {
	Deno.stdout.writeSync(new TextEncoder().encode(s));
}

// printf is not fun to implement. funnily enough, this stack machine
// has better output formatting support than javascript itself :\
function printNumericCommon(insn, n, radix, uppercase, prefix) {
	let s = n.toString(radix);
	if (uppercase)
		s = s.toUpperCase();

	if (n < 0) {
		prefix = "-" + prefix;
		s = s.slice(1);
	}

	if (insn.precision > 0 && s.length < insn.precision) {
		s = "0".repeat(insn.precision - s.length) + s;

		// cancel octal prefix when precision gives us zeroes
		if (s[0] === "0" && radix === 8 && prefix.at(-1) === "0")
			prefix = prefix.slice(0, -1);
	}

	if (insn.positiveSignBlank && !insn.sign && n > -1) {
		prefix = " " + prefix;
	}

	if (insn.sign && n > -1) {
		prefix = "+" + prefix;
	}

	const space = insn.width - (prefix.length + s.length);
	if (space < 1) {
		print(prefix + s);
		return;
	}
	
	if (insn.leftJustify) {
		print(prefix + s + " ".repeat(space));
		return;
	}

	if (!insn.zeroPad) {
		print(" ".repeat(space) + prefix + s);
		return;
	}

	print(prefix + "0".repeat(space) + s);
}

function printd(insn, n) {
	printNumericCommon(insn, n, 10, false, "");
}

function printo(insn, n) {
	let prefix = "";
	if (insn.alternateForm && n > 0)
		prefix = "0";

	printNumericCommon(insn, n, 8, false, prefix);
}

function printx(insn, uppercase, n) {
	let prefix = "";
	if (insn.alternateForm)
		prefix = uppercase ? "0X" : "0x";
	
	printNumericCommon(insn, n, 16, uppercase, prefix);
}

function prints(insn, s) {
	if (insn.precision)
		s = s.slice(0, insn.precision);
	if (insn.width < 1)
		print(s);
	
	const space = insn.width - s.length;

	if (space < 1)
		print(s);

	print((insn.leftJustify ? "" : " ".repeat(space)) + s +
		(insn.leftJustify ? " ".repeat(space) : ""));
}

export class Program {
	static #regDefaults = Object.fromEntries(new Array(26).fill(0).map((_, i) =>
		[String.fromCharCode(0x61 + i), null]));

	#termRef;
	#code;

	#pop(type) {
		const out = this.stack.pop();

		// extra parentheses to avoid eslint bullshit
		if ((typeof(out)) !== type)
			throw new TypeError(`invalid stack value. expected ${type}, got ${typeof(out)}`);

		return out;
	}

	constructor(termctx) {
		// I'm making these public for good will.
		// mess with them at your own risk
		this.#code = [];
		this.needsStatics = false;
		this.maxUsedParam = 0;
		this.terminal = termctx;
		this.reset();
	}

	set instructions(insn) {
		this.#code = insn.slice();
		Object.freeze(this.#code);
		for (const insn of this.#code) {
			if ((insn.opcode.is("SET_VAR") || insn.opcode.is("PUSH_VAR")) && insn.name === insn.name.toUpperCase())
				this.needsStatics = true;
			if (insn.opcode.is("PUSH_PARAM") && this.maxUsedParam < insn.index)
				this.maxUsedParam = insn.index;
		}
	}

	get instructions() {
		return this.#code;
	}

	set terminal(regs) {
		if (regs.constructor !== Terminal)
			throw new TypeError("assigned value must be a Terminal object");
		this.#termRef = regs;
	}

	get terminal() {
		return this.#termRef;
	}

	compile(s) {
		this.instructions = Compiler.compile(s);
	}

	reset() {
		this.dynamicRegisters = Program.#regDefaults; 
		Object.seal(this.dynamicRegisters);
		this.programCounter = 0;
		this.stack = [];
		this.params = [];
		this.executing = false;
		this.done = false;
	}

	execInstruction(insn) {
		if (this.done)
			return;

		switch (insn.opcode.value) {
			case Compiler.Opcode.OUT:
				print(insn.str);
				this.programCounter++;
				break;
			case Compiler.Opcode.DELAY: {
				// NOTE: does not handle proportional delay.
				// ncurses tputs() just takes the affected line count as a
				// parameter and multiplies the delay time by that
				// in the case of proportional delays. /shrug
				// I guess I can come up with something if someone
				// *actually* uses this library with a real fucking
				// VT100 and runs into hardware overruns, or something
				if (!this.#termRef.usePadding && !insn.force)
					return;
				
				// TODO: implement char-based padding when termios is available.
				// # of characters: (insn.time * BAUDRATE) / 9000;
				// the character should be either termRef.strings.pad_char
				// or null if undefined.
				// also remember to check termRef.numbers.padding_baud_rate
				// if (!this.#termRef.nullPad) {
				const until = Date.now() + insn.time;
				while (Date.now() < until);
				this.programCounter++;
				break;
				// }
			}
			case Compiler.Opcode.PRINT:
				switch (insn.format) {
					case "c":
						print(String.fromCharCode(this.#pop("number")));
						break;
					case "d":
						printd(insn, this.#pop("number"));
						break;
					case "o":
						printo(insn, this.#pop("number"));
						break;
					case "x":
						printx(insn, false, this.#pop("number"));
						break;
					case "X":
						printx(insn, true, this.#pop("number"));
						break;
					case "s":
						prints(insn, this.#pop("string"));
						break;
				}
				this.programCounter++;
				break;
			case Compiler.Opcode.PUSH_PARAM:
				this.stack.push(this.params[insn.index - 1]);
				this.programCounter++;
				break;
			default:
				throw new TypeError("Instructions WIP");
		}

		if (this.programCounter >= this.#code.length)
			this.done = true;
	}

	begin() {
		if (!this.executing) {
			if (this.needsStatics && this.staticRegisters === undefined)
				throw new TypeError("this program uses static registers, but none are assigned");
			const parm = [...arguments];
			if (parm.find(e => (typeof(e) !== "number" && typeof(e) !== "string")))
				throw new TypeError("attempted to pass parameter of invalid type");
			if (parm.length < this.maxUsedParam)
				throw new RangeError(`not enough parameters (${parm.length}) for program using ${this.maxUsedParam} parameters`);
			this.params = parm;
			this.executing = true;
		}
	}


	step() {
		this.execInstruction(this.#code[this.programCounter]);
	}

	exec() {
		this.begin.apply(this, [...arguments]);
		while (!this.done)
			this.execInstruction(this.#code[this.programCounter]);
		this.reset();
	}
}

// roughly equivalent to ncurses TERMINAL structs, but not really
export class Terminal {
	static #staticRegDefaults = Object.fromEntries(new Array(26).fill(0).map((_, i) =>
		[String.fromCharCode(0x41 + i), null]));

	#ti;

	constructor(ti) {
		this.staticRegisters = Terminal.#staticRegDefaults;
		Object.seal(this.staticRegisters);
		this.usePadding = true;
		// TODO: unused until termios implementation
		this.nullPad = false;
		this.termInfo = ti;
	}

	set termInfo(ti) {
		if (ti?.constructor !== TermInfo.Entry)
			throw new TypeError("please supply a terminfo entry");
		this.#ti = ti;
	}

	get termInfo() {
		return this.#ti;
	}

	compile(capname) {
		const prog = new Program(this);
		prog.compile(this.#ti.strings[capname]);
		return prog;
	}
}
