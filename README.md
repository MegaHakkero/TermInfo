# TermInfo

A library for parsing binary ncurses terminfo descriptions, except it's in
javascript. **Gross**.<br/>
Also comes with a compiler and runtime for executing string capabilities.<br/>
Written against ncurses 6.4. Does not support the berkeley database format
("hashed database"), but I haven't seen that used anywhere.

### Instructions

Clone this repo or set it up as a git submodule and import stuff from the
files. For general use, you want to look at `terminfo.js` and
`program.js`.<br/>
I might write a higher level API for `program.js` for drawing graphics, like
ncurses, but for now you'll need to use the low level API.

### Why no typescript? Deno has built-in support for it

I don't see much sense in typescript. Any API that has a chance to be used
outside typescript will need to include javascript type guards anyhow, and
having to add types to everything just for the sake of static analysis
seems like a pointless chore to me.<br/>
You can figure out what everything does even without types. I believe in you!
