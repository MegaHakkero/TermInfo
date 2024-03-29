/* enum.js - Enums
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

class EnumResult {
	constructor(key, value) {
		if (key === undefined)
			return;

		this.key   = key.toString();
		this.value = value;
	}

	is(kv) {
		return (typeof(kv) === "string") ? this.key === kv : this.value === kv;
	}

	toString() {
		return this.key + " (" + this.value.toString() + ")";
	}
}

export default function Enum() {
	const enumInstance = function(value, nag = true) {
		const key = Object.keys(enumInstance).find(k => enumInstance[k] === value);
		if (nag && key === undefined)
			throw new TypeError("invalid enum value: " + value.toString());
		return new EnumResult(key, enumInstance[key], nag);
	}

	let current = 0;

	for (let i = 0; i < arguments.length; i++) {
		const arg = arguments[i];

		if (Array.isArray(arg)) {
			enumInstance[arg[0]] = arg[1];
			if (typeof(arg[1]) === "number")
				current = arg[1] + 1;
			continue;
		}
		
		if (typeof(arg) !== "string")
			throw new TypeError("string required, got " + typeof(arg));

		enumInstance[arg] = current++;
	}
	
	return Object.freeze(enumInstance);
}
