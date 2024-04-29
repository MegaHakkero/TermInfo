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
import { RuntimeError } from './errors.js';

function checkTerminfoLike(ti) {
	if (ti?.booleans !== undefined &&
		ti?.numbers !== undefined &&
		ti?.strings !== undefined)
		return true;
	return false;
}

// printf is not fun to implement. funnily enough, this stack machine
// has better output formatting support than javascript itself :\
function fmtNumericCommon(insn, n, radix, uppercase, prefix) {
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
	if (space < 1)
		return prefix + s;
	
	if (insn.leftJustify)
		return prefix + s + " ".repeat(space);

	if (!insn.zeroPad)
		return " ".repeat(space) + prefix + s;

	return prefix + "0".repeat(space) + s;
}

function fmtd(insn, n) {
	return fmtNumericCommon(insn, n, 10, false, "");
}

function fmto(insn, n) {
	let prefix = "";
	if (insn.alternateForm && n > 0)
		prefix = "0";

	return fmtNumericCommon(insn, n, 8, false, prefix);
}

function fmtx(insn, uppercase, n) {
	let prefix = "";
	if (insn.alternateForm)
		prefix = uppercase ? "0X" : "0x";
	
	return fmtNumericCommon(insn, n, 16, uppercase, prefix);
}

function fmts(insn, s) {
	if (insn.precision)
		s = s.slice(0, insn.precision);
	if (insn.width < 1)
		return s;
	
	const space = insn.width - s.length;

	if (space < 1)
		return s;

	return (insn.leftJustify ? "" : " ".repeat(space)) + s +
		(insn.leftJustify ? " ".repeat(space) : "");
}

export class Program {
	static #regDefaults = Object.fromEntries(new Array(26).fill(0).map((_, i) =>
		[String.fromCharCode(0x61 + i), null]));

	static #paramDefaults = new Array(9).fill(0);

	#termRef;
	#hasCode;
	#code;

	#rt = {
		[Compiler.Opcode.OUT]: insn => {
			this.#output(insn.str);
		},
		[Compiler.Opcode.DELAY]: insn => {
			// no delays unless we're actually writing to standard out
			if (!this.#termRef.directOutput)
				return;

			if (this.#termRef.disableDelays && !insn.force)
				return;

			// TODO: implement char-based padding when termios is available.
			// # of characters: (insn.time * BAUDRATE) / 9000;
			// the character should be either termRef.termInfo.strings.pad_char
			// or null if undefined.
			// also remember to check termRef.termInfo.numbers.padding_baud_rate
			// if (!this.#termRef.nullPad) {
			const until = Date.now() +
				insn.time * (insn.proportional ? this.affectedLines : 1);
			while (Date.now() < until);
			// }
		},
		[Compiler.Opcode.PRINT]: insn => {
			switch (insn.format) {
				case "c":
					this.#output(String.fromCharCode(this.#pop("number")));
					break;
				case "d":
					this.#output(fmtd(insn, this.#pop("number")));
					break;
				case "o":
					this.#output(fmto(insn, this.#pop("number")));
					break;
				case "x":
					this.#output(fmtx(insn, false, this.#pop("number")));
					break;
				case "X":
					this.#output(fmtx(insn, true, this.#pop("number")));
					break;
				case "s":
					this.#output(fmts(insn, this.#pop("string")));
					break;
			}
		},
		[Compiler.Opcode.PUSH_PARAM]: insn => {
			this.stack.push(this.params[insn.index - 1]);
		},
		[Compiler.Opcode.SET_VAR]: insn => {
			if (insn.name === insn.name.toLowerCase()) {
				this.dynamicRegisters[insn.name] = this.#pop();
				return;
			}
			this.#termRef.staticRegisters[insn.name] = this.#pop();
		},
		[Compiler.Opcode.PUSH_VAR]: insn => {
			if (insn.name === insn.name.toLowerCase()) {
				this.stack.push(this.dynamicRegisters[insn.name]);
				return;
			}
			this.stack.push(this.#termRef.staticRegisters[insn.name]);
		},
		[Compiler.Opcode.CONSTANT]: insn => {
			this.stack.push(insn.value);
		},
		[Compiler.Opcode.STRLEN]: _ => {
			this.stack.push(this.#pop("string"));
		},
		[Compiler.Opcode.PARAM_INC]: _ => {
			this.params[0]++;
			this.params[1]++;
		},
		[Compiler.Opcode.ADD]: _ => {
			const op1 = this.#pop("number");
			this.stack.push(this.#pop("number") + op1);
		},
		[Compiler.Opcode.SUBTRACT]: _ => {
			const op1 = this.#pop("number");
			this.stack.push(this.#pop("number") - op1);
		},
		[Compiler.Opcode.MULTIPLY]: _ => {
			const op1 = this.#pop("number");
			this.stack.push(this.#pop("number") * op1);
		},
		[Compiler.Opcode.DIVIDE]: _ => {
			const op1 = this.#pop("number");
			this.stack.push(Math.floor(this.#pop("number") / op1));
		},
		[Compiler.Opcode.MODULO]: _ => {
			const op1 = this.#pop("number");
			this.stack.push(this.#pop("number") % op1);
		},
		[Compiler.Opcode.AND]: _ => {
			const op1 = this.#pop("number");
			this.stack.push(this.#pop("number") & op1);
		},
		[Compiler.Opcode.OR]: _ => {
			const op1 = this.#pop("number");
			this.stack.push(this.#pop("number") | op1);
		},
		[Compiler.Opcode.XOR]: _ => {
			const op1 = this.#pop("number");
			this.stack.push(this.#pop("number") ^ op1);
		},
		[Compiler.Opcode.NOT]: _ => {
			this.stack.push(~this.#pop("number"));
		},
		[Compiler.Opcode.CMP_EQUAL]: _ => {
			const op1 = this.#pop();
			this.stack.push(Number(this.#pop() === op1));
		},
		[Compiler.Opcode.CMP_GREATER]: _ => {
			const op1 = this.#pop();
			this.stack.push(Number(this.#pop() > op1));
		},
		[Compiler.Opcode.CMP_LESS]: _ => {
			const op1 = this.#pop();
			this.stack.push(Number(this.#pop() < op1));
		},
		[Compiler.Opcode.CMP_AND]: _ => {
			const op1 = this.#pop();
			this.stack.push(Number(this.#pop() && op1));
		},
		[Compiler.Opcode.CMP_OR]: _ => {
			const op1 = this.#pop();
			this.stack.push(Number(this.#pop() || op1));
		},
		[Compiler.Opcode.CMP_NOT]: _ => {
			this.stack.push(Number(!this.#pop()));
		},
		[Compiler.Opcode.JUMP_ZERO]: insn => {
			const v = this.#pop();
			if (v === 0 || v === "")
				this.programCounter += insn.position;
		},
		[Compiler.Opcode.JUMP]: insn => {
			this.programCounter += insn.position;
		}
	};

	#output(s) {
		this.output += s;
		// TODO: implement ability to define custom write routine and
		// support common runtimes
		if (this.#termRef.directOutput)
			Deno.stdout.write(new TextEncoder().encode(s));
	}

	#pop(type) {
		if (this.stack.length < 1)
			throw new RuntimeError("stack exhausted");

		const out = this.stack.pop();

		if (type === undefined)
			return out;

		// extra parentheses to avoid eslint bullshit
		if ((typeof(out)) !== type)
			throw new TypeError(`invalid stack value. expected ${type}, got ${typeof(out)}`);

		return out;
	}

	constructor(termctx, code) {
		this.#code = [];
		this.maxUsedParam = 0;
		this.terminal = termctx;
		this.reset();

		if (code !== undefined)
			this.compile(code);
	}

	set instructions(insn) {
		if (this.#hasCode)
			throw new TypeError("cannot modify existing code. create a new Program instead");
		this.#hasCode = true;
		this.#code = insn.slice();
		Object.freeze(this.#code);
		for (const insn of this.#code) {
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
		this.affectedLines = 1;
		this.programCounter = 0;
		this.stack = [];
		this.params = Program.#paramDefaults;
		this.output = "";
		this.executing = false;
		this.done = false;
	}

	execInstruction(insn) {
		if (this.done)
			return;

		if (this.#rt[insn.opcode.value] === undefined)
			throw new TypeError("Instructions WIP");

		this.#rt[insn.opcode.value](insn);

		if (++this.programCounter >= this.#code.length)
			this.done = true;
	}

	begin() {
		if (!this.executing) {
			const parm = [...arguments];
			if (parm.find(e => (typeof(e) !== "number" && typeof(e) !== "string")))
				throw new TypeError("attempted to pass parameter of invalid type");
			if (parm.length < this.maxUsedParam)
				throw new RangeError(`not enough parameters (${parm.length}) for program using ${this.maxUsedParam} parameters`);
			this.params.splice(0, parm.length, ...parm);
			this.executing = true;
		}
	}


	step() {
		this.execInstruction(this.#code[this.programCounter]);
		if (this.done)
			return this.output;
	}

	// the first argument is the number of lines affected by the control code
	// generated by the program being executed. it's a multiplier for the delay
	// time in proportional delays. most emulators for old terminals that use
	// proportional delays don't emulate hardware overruns, so you can use 1 here
	// most of the time when using this API directly.
	exec(aff) {
		if (typeof(aff) !== "number" || aff < 1)
			throw new TypeError("first argument must be a number >= 1");
		this.affectedLines = aff;
		this.begin.apply(this, [...arguments].slice(1));
		while (!this.done)
			this.execInstruction(this.#code[this.programCounter]);
		const out = this.output;
		this.reset();
		return out;
	}
}

export class Terminal {
	static #staticRegDefaults = Object.fromEntries(new Array(26).fill(0).map((_, i) =>
		[String.fromCharCode(0x41 + i), null]));

	static #tiEmpty = { booleans: {}, numbers: {}, strings: {} };

	#ti;

	constructor(ti = Terminal.#tiEmpty) {
		this.staticRegisters = Terminal.#staticRegDefaults;
		Object.seal(this.staticRegisters);
		this.directOutput = false;
		this.disableDelays = false;
		// TODO: unused until termios implementation
		this.nullPad = false;
		this.termInfo = ti;
	}

	set termInfo(ti) {
		if (!checkTerminfoLike(ti))
			throw new TypeError("please supply an object that contains capabilities (see checkTerminfoLike() source)");
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
