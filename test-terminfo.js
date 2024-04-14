/* test-terminfo.js - tests for terminfo.js (lol)
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

import * as TI from "./terminfo.js";

Deno.test({
	name: "Parse all terminals",
	permissions: {
		env: true,
		read: true
	},
	fn() {
		const db = new TI.DB("/usr/share/terminfo");
		let n = 0, n32bit = 0, nExt = 0;

		for (const term of Object.keys(db.entries)) {
			const ti = db.load(term);
			if (ti.is32bit())
				n32bit++;
			if (ti.isExtended())
				nExt++;
			Deno.stdout.writeSync(new TextEncoder().encode(
				`${++n} terminals OK (32bit=${n32bit}, ext=${nExt})\r`));
		}

		console.log("");
	}
});

Deno.test({
	name: "Test for duplicates in TermInfo.DB",
	permissions: {
		read: true
	},
	fn() {
		const db   = new TI.DB("/usr/share/terminfo");
		const keys = Object.keys(db.entries);
		for (const term of keys) {
			const nEntries = keys.filter(n => n === term).length;
			if (nEntries > 1)
				throw new RangeError(`found ${nEntries} entries for ${term}`);
		}
	}
});
