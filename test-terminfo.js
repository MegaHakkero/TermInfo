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

import TermInfo from "./terminfo.js";

function getAllTerminals(db) {
	if (Deno.statSync(db).isFile)
		return [db];

	const stuff = [];

	for (const entry of Deno.readDirSync(db))
		stuff.push(...getAllTerminals(db + "/" + entry.name));

	return stuff;
}

Deno.test({
	name: "Parse all terminals",
	permissions: {
		env: true,
		read: true
	},
	fn() {
		for (const term of getAllTerminals("/usr/share/terminfo")) {
			Deno.stdout.writeSync(new TextEncoder().encode(term + "... "));
			const ti = new TermInfo(term);
			console.log("OK '" + ti.names.detailed + "';" +
				(ti.header.magic.is("MAGIC_32") ? " 32-bit" : "") +
				((ti.extHeader !== undefined) ? " extended" : ""));
		}
	}
});
