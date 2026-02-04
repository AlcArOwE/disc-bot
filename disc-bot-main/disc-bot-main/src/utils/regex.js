/**
 * Regex Patterns - All pattern matching for the bot
 */

const config = require('../../config.json');

// Bet pattern: matches "10v10", "10vs10", "15.5 vs 15.5", "$10 v $10"
// Refined to handle conversational punctuation like "10v10?"
const BET_PATTERN = /(?:^|\s)\$?(\d+(?:\.\d{1,2})?)\s*(?:v|vs)\s*\$?(\d+(?:\.\d{1,2})?)(?![0-9.])/i;

// Crypto address patterns
const CRYPTO_PATTERNS = {
    // Litecoin: L, M, or 3 prefix (Legacy), or ltc1 (Bech32)
    LTC: /^(L|M|3)[1-9A-HJ-NP-Za-km-z]{26,45}$|^ltc1[a-z0-9]{35,60}$/i,

    // Solana: Base58, 32-44 characters
    SOL: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
};

// Pattern to detect middleman starting the game
// e.g., "game start", "rolling", "go", "begin", "ft5 @bot first", "you first"
const GAME_START_PATTERN = /(?:game\s*start|rolling|begin|go|ft\d+|ready|start|lets\s*go).*?(?:<@!?(\d+)>|(\b\w+\b))?.*?(?:first|go|turn|start|roll)|(?:you|bot|he|she)\s*(?:go|first|start|roll)/i;
const GAME_START_KEYWORDS = ['game start', 'rolling', 'begin', 'go', 'start the game', 'ready to roll', 'start', 'lets go', 'roll', 'ur turn', 'your turn', 'bot turn'];
const GAME_START_FALLBACK = /(?:<@!?(\d+)>|(\b\w+\b)).*?(?:first|go|turn|start|roll)/i;

// Pattern to detect dice roll results from dice bots
// Matches common formats like "rolled a 6", "🎲 6", "[6]", "rolled a **6**"
const DICE_RESULT_PATTERN = /(?:rolled?\s*(?:a\s*)?|🎲\s*|\[\s*|result:\s*|result\s*:\s*)\**(\d+)\**(?:\s*\])?/i;

// Pattern to detect round/game announcements
const ROUND_PATTERN = /round\s*(\d+)|game\s*(\d+)|ft\s*(\d+)/i;

// Pattern for payment confirmation keywords
const PAYMENT_CONFIRM_PATTERNS = [
    /confirmed?/i,
    /received?/i,
    /got\s*(?:it|payment)/i,
    /paid/i,
    /sent/i,
    /both\s*(?:paid|sent|received)/i,
    /payments?\s*(?:confirmed|received)/i,
    /gl\b/i,
    /good\s*luck/i,
    /start\s*(?:the\s*)?game/i,
    /ready\s*to\s*(?:go|start|play)/i,
    /rolled?/i,
    /\bgo\b/i,
    /\bstart\b/i,
    /\bover\b/i,
    /both\s*in/i,
    /ur\s*turn/i
];

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3.5: DYNO/TICKET BOT NOTIFICATION PATTERNS
// Detect when ticket bots post messages indicating a new ticket was created
// ═══════════════════════════════════════════════════════════════════════════════
const DYNO_TICKET_PATTERNS = [
    // Dyno ticket creation messages
    /ticket\s*(?:created|opened|started)/i,
    /new\s*ticket\s*(?:from|by|opened)/i,
    /support\s*ticket\s*(?:#|\d+)/i,
    /(?:welcome|hello).*ticket/i,
    // Ticket Tool messages
    /ticket\s*(?:has\s*been|was)\s*(?:created|opened)/i,
    /staff\s*will\s*(?:be\s*with\s*you|assist)/i,
    /please\s*(?:wait|describe)/i,
    // Generic ticket creation indicators
    /order\s*(?:#|\d+|created)/i,
    /case\s*(?:#|\d+|opened)/i,
];

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4.6: ADVERTISEMENT REFERENCE PATTERNS
// Detect if user mentions seeing the bot's ad
// ═══════════════════════════════════════════════════════════════════════════════
const AD_REFERENCE_PATTERNS = [
    /saw\s*(?:the|your|ur)\s*ad/i,
    /from\s*(?:the|your|ur)\s*ad/i,
    /seen\s*(?:the|your|ur)\s*ad/i,
    /your\s*advertisement/i,
    /ur\s*advertisement/i,
    /the\s*ad\s*in/i,
    /dice\s*bot\s*ad/i,
    /saw\s*u\s*in/i,
    /seen\s*u\s*in/i,
];

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 14: VOUCH & PAYMENT RECEPTION KEYWORDS
// Detect if player says they paid, vouched, or thanks
// ═══════════════════════════════════════════════════════════════════════════════
const VOUCH_KEYWORDS = [
    /vouch/i,
    /paid/i,
    /sent/i,
    /thanks/i,
    /ty/i,
    /gg/i,
    /done/i,
    /received/i,
    /got\s*it/i,
    /nice\s*one/i,
    /posted/i
];

// ═══════════════════════════════════════════════════════════════════════════════
// INTELLIGENT PATTERN MATCHING (Master Prompt REQ 2)
// COMPREHENSIVE COVERAGE - All possible ticket conversation phrases
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// AFFIRMATIVE / CONFIRMATION PATTERNS (50+ patterns)
// ═══════════════════════════════════════════════════════════════════════════════
const CONFIRM_PATTERNS = [
    // Basic yes variations
    /\by(?:e[ahs]*|up|ep)?\b/i,                    // y, ye, yea, yeah, yes, yep, yup
    /\b(?:yup+|yee+|yess+|yea+h?)\b/i,             // yupp, yeee, yesss, yeaah
    /\b(?:ye+s*|ya+h?|yeh)\b/i,                    // yeee, yaaah, yeh
    /\b(?:yessir|yes\s*sir)\b/i,                   // yessir, yes sir

    // OK variations
    /\b(?:ok(?:a?y|k+|i+)?|k+)\b/i,                // ok, okay, okk, oki, k, kk, kkk
    /\b(?:okie|okii|okayyy)\b/i,                   // okie, okii, okayyy
    /\b(?:ight|aight|a+ight|aii+ght)\b/i,          // ight, aight, aaight, aiight

    // Confirmation words
    /\b(?:confirm(?:ed)?|conf)\b/i,                // confirm, confirmed, conf
    /\b(?:sure|4\s*sure|for\s*sure|fs)\b/i,        // sure, 4 sure, for sure, fs
    /\b(?:definitely|def|deff|deffo)\b/i,          // definitely, def, deff, deffo
    /\b(?:absolutely|absol?|abs)\b/i,              // absolutely, absol, abs
    /\b(?:positive|pos)\b/i,                       // positive, pos
    /\b(?:affirmative|affirm)\b/i,                 // affirmative, affirm
    /\b(?:correct|right|true|tru)\b/i,             // correct, right, true, tru
    /\b(?:valid|legit|leg)\b/i,                    // valid, legit, leg
    /\b(?:100|hund+red|onehundred)\b/i,            // 100, hundred, onehundred
    /\b(?:facts?|fax|no\s*cap)\b/i,                // fact, facts, fax, no cap

    // Agreement/deal words
    /\b(?:bet+|bett+|be+t)\b/i,                    // bet, bett, bettt, beeet
    /\b(?:deal|done|agreed?|agre+d)\b/i,           // deal, done, agree, agreed
    /\b(?:works?|werk|perfect|perf)\b/i,           // work, works, werk, perfect, perf
    /\b(?:fine|good|great|awesome)\b/i,            // fine, good, great, awesome
    /\b(?:cool|kool|coo|coool)\b/i,                // cool, kool, coo, coool
    /\b(?:nice|noice|solid)\b/i,                   // nice, noice, solid
    /\b(?:lit|fire|dope|sick)\b/i,                 // lit, fire, dope, sick
    /\b(?:say\s*less|less|sless)\b/i,              // say less, less, sless
    /\b(?:word|wrd|wordd)\b/i,                     // word, wrd, wordd
    /\b(?:copy|copied|gotcha|gotchu)\b/i,          // copy, copied, gotcha, gotchu

    // Ready/go words
    /\b(?:down|i'?m\s*down|imdown)\b/i,            // down, im down, i'm down
    /\b(?:ready|rdy|readyy|redy)\b/i,              // ready, rdy, readyy
    /\b(?:le[ts]+\s*go|le+s+go|lesss?go)\b/i,      // lets go, let's go, lesgo
    /\b(?:go|goo|gooo|go+)\b/i,                    // go, goo, gooo
    /\b(?:run\s*it|runit)\b/i,                     // run it, runit
    /\b(?:send\s*it|sendit)\b/i,                   // send it, sendit
    /\b(?:locked\s*in?|lockedin|locked)\b/i,       // locked in, lockedin, locked

    // Luck phrases
    /\b(?:gl(?:hf)?|good\s*luck)\b/i,              // gl, glhf, good luck
    /\b(?:hf|have\s*fun)\b/i,                      // hf, have fun

    // Sounds good variations
    /\b(?:sounds?\s*good|sg|sog)\b/i,              // sounds good, sg, sog
    /\b(?:sounds?\s*(?:bet|fine|great|lit))\b/i,   // sounds bet, sounds fine
    /\b(?:that\s*works?|thats?\s*fine)\b/i,        // that works, thats fine
    /\b(?:works?\s*for\s*me|wfm)\b/i,              // works for me, wfm
    /\b(?:im?\s*(?:good|fine|set|in))\b/i,         // im good, i'm fine, im set, im in
    /\b(?:all\s*good|all\s*g|alg)\b/i,             // all good, all g, alg

    // Emoji-based (text representations)
    /👍|✅|💯|✔️?|☑️?|👌|🤝|💪|🔥/,           // thumbs up, check, 100, ok hand, etc.
    /:\+1:|:white_check_mark:|:100:/i,             // Discord emoji codes
    /\b(?:thumbs?\s*up|check|checkmark)\b/i,       // text emoji names

    // Affirmative phrases
    /\b(?:alright|alrite|alrighty)\b/i,            // alright, alrite, alrighty
    /\b(?:fo\s*sho|fosho|4sho)\b/i,                // fo sho, fosho, 4sho
    /\b(?:yee+|yuh|yuhh)\b/i,                      // yee, yeee, yuh, yuhh
    /\b(?:aii|aye|ayy+)\b/i,                       // aii, aye, ayy, ayyy
    /\b(?:fair|fair\s*enough|fe)\b/i,              // fair, fair enough, fe
    /\b(?:understandable|understood|unds)\b/i,     // understandable, understood
    /\b(?:ofc|of\s*course)\b/i,                    // ofc, of course

    // Short affirmatives often used
    /\b(?:ye+p+|yu+p+|yea+p?)\b/i,                 // yepp, yupp, yeap
    /\b(?:mhm+|mm+hm+|uh\s*huh)\b/i,               // mhm, mmhm, uh huh
    /\b(?:si|ja|oui|hai)\b/i,                      // yes in other languages

    // Gambling-specific
    /\b(?:all\s*in|allin)\b/i,                     // all in
    /\b(?:ship\s*it|shipit)\b/i,                   // ship it
    /\b(?:fade|faded)\b/i,                         // fade (take the bet)
    /\b(?:booked|book\s*it)\b/i,                   // booked, book it
];

// ═══════════════════════════════════════════════════════════════════════════════
// NEGATIVE / REJECTION PATTERNS (40+ patterns)
// ═══════════════════════════════════════════════════════════════════════════════
const DECLINE_PATTERNS = [
    // Basic no variations
    /^(?:no?|na+h?|nope|nop|naw)$/i,             // no, n, nah, naah, nope, nop, naw
    /^(?:nay|neh|nuh|nu+h?|nn+o+)$/i,            // nay, neh, nuh, nuuh, nnoo
    /^(?:hell\s*no|helll?\s*na+h?)$/i,           // hell no, hell nah
    /^(?:no+pe+|nop+e+)$/i,                      // noope, noppee

    // Wait/pause
    /^(?:wait|hold|hold\s*up|holup)$/i,          // wait, hold, hold up, holup
    /^(?:stop|pause|sec|one\s*sec)$/i,           // stop, pause, sec, one sec
    /^(?:gimme\s*a?\s*sec|gimmie)$/i,            // gimme a sec, gimmie
    /^(?:brb|1\s*sec|one\s*moment)$/i,           // brb, 1 sec, one moment

    // Wrong/incorrect
    /^(?:wrong|incorrect|nvm|nevermind)$/i,      // wrong, incorrect, nvm, nevermind
    /^(?:not\s*(?:that|right|correct))$/i,       // not that, not right
    /^(?:thats?\s*wrong|thats?\s*not)$/i,        // thats wrong, that's not

    // Negation phrases
    /(?:don'?t|can'?t|won'?t|wouldn'?t)/i,       // dont, can't, won't, wouldn't
    /(?:not|never|no\s*way|noway)/i,             // not, never, no way
    /^(?:i\s*(?:don'?t|can'?t|won'?t))$/i,       // i dont, i can't, i won't
    /^(?:ain'?t|aint|isnt|isn'?t)$/i,            // ain't, aint, isnt

    // Pass/skip
    /^(?:pass|skip|later|next\s*time)$/i,        // pass, skip, later, next time
    /^(?:not\s*(?:now|rn|today|interested))$/i,  // not now, not rn, not today
    /^(?:im?\s*(?:good|out|passing))$/i,         // im good (declining), im out, im passing
    /^(?:nty|no\s*(?:thanks?|thx|ty))$/i,        // nty, no thanks, no thx

    // Cancel/void
    /^(?:cancel|void|refund|reset)$/i,           // cancel, void, refund, reset
    /^(?:abort|stop\s*it|forget\s*it)$/i,        // abort, stop it, forget it
    /^(?:scratch\s*that|nvm\s*that)$/i,          // scratch that, nvm that

    // Bet amount issues
    /^(?:too\s*(?:high|much|low|little))$/i,     // too high, too much, too low
    /^(?:lower|higher|less|more)$/i,             // lower, higher, less, more
    /^(?:change|different|other)$/i,             // change, different, other
    /^(?:thats?\s*too\s*(?:much|high))$/i,       // thats too much, that's too high

    // Uncertainty as rejection
    /^(?:idk|i\s*don'?t\s*know)$/i,              // idk, i dont know
    /^(?:not\s*sure|unsure)$/i,                  // not sure, unsure
    /^(?:doubt\s*it|doubtful)$/i,                // doubt it, doubtful

    // Emoji-based rejections
    /^(?:👎|❌|🚫|❎|🛑|✖️?)$/,                      // thumbs down, X, stop, etc.
    /^(?::-1:|:x:|:no_entry:)$/i,                // Discord emoji codes

    // Slang rejections
    /^(?:heck\s*no|foh|gtfo)$/i,                 // heck no, foh, gtfo
    /^(?:miss\s*me|miss)$/i,                     // miss me, miss
    /^(?:cap|thats?\s*cap)$/i,                   // cap, thats cap (lying/false)
    /^(?:sus|sketchy|shady)$/i,                  // sus, sketchy, shady
    /^(?:scam|fake|fraud)$/i,                    // scam, fake, fraud

    // Negative vibes
    /^(?:bad|trash|garbage|ass)$/i,              // bad, trash, garbage
    /^(?:no+\s*(?:shot|chance|dice))$/i,         // no shot, no chance, no dice
    /^(?:fat\s*(?:chance|no))$/i,                // fat chance, fat no

    // Changed mind
    /^(?:actually\s*(?:no|nah|nvm))$/i,          // actually no, actually nah
    /^(?:changed?\s*(?:my\s*)?mind)$/i,          // change my mind, changed mind
    /^(?:back\s*out|backing\s*out)$/i,           // back out, backing out
];

// ═══════════════════════════════════════════════════════════════════════════════
// AMBIGUOUS PATTERNS - Need clarification (25+ patterns)
// ═══════════════════════════════════════════════════════════════════════════════
const AMBIGUOUS_PATTERNS = [
    // Confused responses
    /^(?:hmm+|huh|what|hm+)$/i,                  // hmm, huh, what, hm
    /^(?:wdym|wym|what\s*(?:do\s*)you\s*mean)$/i, // wdym, wym, what do you mean
    /^(?:idk|i\s*(?:dunno|don'?t\s*know))$/i,   // idk, i dunno, i dont know
    /^(?:confused|lost|wut|wat)$/i,              // confused, lost, wut, wat
    /^(?:come\s*again|say\s*what)$/i,            // come again, say what

    // Uncertainty
    /^(?:maybe|perhaps|possibly|might)$/i,       // maybe, perhaps, possibly, might
    /^(?:could\s*be|might\s*be|possibly)$/i,     // could be, might be
    /^(?:depends|it\s*depends)$/i,               // depends, it depends
    /^(?:not\s*(?:sure|certain))$/i,             // not sure, not certain
    /^(?:uncertain|unsure)$/i,                   // uncertain, unsure

    // Just question marks or ellipsis
    /^[?\s]+$/i,                                 // just question marks
    /^\.{2,}$/i,                                 // just dots ...
    /^(?:\.\.\.|…)$/,                            // ellipsis

    // Request for info
    /^(?:explain|clarify|elaborate)$/i,          // explain, clarify, elaborate
    /^(?:can\s*you\s*explain|meaning)$/i,        // can you explain, meaning
    /^(?:how|why|when|where|who)$/i,             // how, why, when, where, who
    /^(?:howd|how'?d|how\s*(?:come|so))$/i,      // howd, how come, how so

    // Thinking responses
    /^(?:let\s*me\s*think|thinking|lemme\s*think)$/i, // let me think, thinking
    /^(?:one\s*(?:sec|moment)|sec)$/i,           // one sec, one moment (could be stalling)
    /^(?:hold\s*(?:on|up))$/i,                   // hold on, hold up

    // Emoji-based ambiguity
    /^(?:🤔|🤷|😐|😕|❓|⁉️?)$/,                     // thinking, shrug, neutral, confused
    /^(?::thinking:|:shrug:)$/i,                 // Discord emoji codes

    // Single letters that are unclear
    /^(?:u|i|o|r|ur|a|an|uh)$/i,                 // single unclear letters
    /^(?:so|and|but|or|if|um+|er+)$/i,           // filler words

    // Reactions without clear meaning
    /^(?:lol|lmao|lmfao|haha+|hehe+)$/i,         // laughing (could mean anything)
    /^(?:bruh|bro|dude|man)$/i,                  // exclamations
    /^(?:damn|dang|dayum|sheesh)$/i,             // exclamations (neutral)
    /^(?:interesting|wild|crazy)$/i,             // neutral reactions
];

// ═══════════════════════════════════════════════════════════════════════════════
// GAME START SIGNALS (60+ signals)
// ═══════════════════════════════════════════════════════════════════════════════
const GAME_START_SIGNALS = [
    // Explicit game start
    'game start', 'game on', 'game time', 'start game', 'begin game',
    'lets play', 'lets roll', 'lets go', 'letsgo', 'lesgo', 'lessgo',
    'start', 'begin', 'go', 'starting', 'beginning',

    // Roll commands
    'roll', 'rolling', 'roll now', 'start rolling', 'begin rolling',
    '-roll', '/roll', '.roll', '!roll',

    // Turn indicators
    'your turn', 'ur turn', 'u turn', 'you go', 'u go',
    'you first', 'u first', 'bot first', 'bot goes', 'he goes',
    'his turn', 'its your turn', 'its ur turn', 'your go',

    // Luck/ready phrases
    'gl', 'glhf', 'good luck', 'good luck have fun',
    'hf', 'have fun', 'gl gl', 'glgl',
    'ready', 'rdy', 'im ready', 'i am ready', 'are you ready',

    // Game signals
    'ft5', 'ft3', 'ft10', 'first to 5', 'first to 3', 'first to',
    'best of', 'bo5', 'bo3', 'bo7',

    // Both paid signals
    'both in', 'both paid', 'both sent', 'all in',
    'payments confirmed', 'payment confirmed', 'payments received',
    'money in', 'funds received', 'got the funds',
    'confirmed both', 'both confirmed',

    // Action signals
    'here we go', 'lets see', 'lets get it', 'lets goo',
    'run it', 'send it', 'do it', 'hit it',
    'show me', 'show me what you got',
    'time to roll', 'time to play', 'time to win',

    // Winner/tie rules mentioned
    'bot wins ties', 'he wins ties', 'you win ties',
    'higher wins', 'high roll wins', 'highest wins',

    // Encouragement (often before game)
    'get it', 'go get it', 'its on', 'its go time',
    'locked and loaded', 'locked in', 'we locked in',
];

// ═══════════════════════════════════════════════════════════════════════════════
// TURN INDICATORS (15+ patterns)
// ═══════════════════════════════════════════════════════════════════════════════
const TURN_INDICATORS = [
    // Direct turn indicators
    /(?:your|ur|u)\s*(?:turn|go|roll)/i,              // your turn, ur turn, u go
    /(?:bot|you)\s*(?:first|go|roll|start|turn)/i,    // bot first, you go, you roll
    /(?:its?\s*)?(?:your|ur|u)\s*(?:turn|go|move)/i,  // its your turn, ur go

    // Mention-based
    /<@!?\d+>\s*(?:go|roll|turn|first|start)/i,       // @mention go/roll/turn
    /<@!?\d+>\s+(?:ur?|you)\s*(?:turn|go)/i,          // @mention u turn, @mention your go

    // Waiting indicators
    /waiting\s*(?:on|for)\s*(?:you|bot|u)/i,          // waiting on you, waiting for bot
    /(?:we|i(?:'m)?)\s*waiting/i,                     // we waiting, im waiting

    // After roll, your turn
    /(?:rolled?|got)\s*(?:a\s*)?\d+.*(?:you|ur|your|bot)/i, // rolled 6, your turn
    /\d+.*(?:your|ur|u)\s*(?:turn|go)/i,              // "6, your turn"
    /(?:i\s*got|got\s*a?)\s*\d+/i,                    // i got 6, got a 5

    // Imperative
    /^roll$/i,                                        // just "roll"
    /^(?:go|go\s*ahead|proceed)$/i,                   // go, go ahead, proceed
    /^(?:next|you'?re?\s*up|ur\s*up)$/i,              // next, youre up, ur up
    /^(?:do\s*it|hit\s*it|send\s*it)$/i,             // do it, hit it, send it

    // Score-based turn signals
    /\d+\s*[-:]\s*\d+.*(?:roll|go|turn)/i,            // 2-1, roll / 3:2, your go
    /(?:score|its?)\s*\d+\s*[-:]\s*\d+/i,             // score 2-1, its 3:2
];

// ═══════════════════════════════════════════════════════════════════════════════
// WIN/LOSS PATTERNS (for detecting game outcomes in chat)
// ═══════════════════════════════════════════════════════════════════════════════
const WIN_PATTERNS = [
    /(?:you|bot|he)\s*(?:won?|wins?|winner)/i,        // you won, bot wins, he winner
    /(?:i|we)\s*(?:lost?|lose)/i,                     // i lost, we lose
    /(?:gg|good\s*game|well\s*played|wp)/i,           // gg, good game, well played
    /(?:congrats|congratulations|gratz|gz)/i,         // congrats, gz
    /(?:nice|noice|clutch|ez|easy)/i,                 // nice, clutch, ez
];

const LOSS_PATTERNS = [
    /(?:i|we)\s*(?:won?|wins?|winner)/i,              // i won, we win (bot lost)
    /(?:you|bot|he)\s*(?:lost?|lose)/i,               // you lost, bot lose
    /(?:unlucky|unlucko|rip|rippp)/i,                 // unlucky, rip
    /(?:damn|dang|oof|yikes)/i,                       // damn, oof (sympathy)
];

// ═══════════════════════════════════════════════════════════════════════════════
// INFO REQUEST PATTERNS (Phase 5 - when opponent asks what bets are available)
// ═══════════════════════════════════════════════════════════════════════════════
const INFO_REQUEST_PATTERNS = [
    // Direct questions about games/bets
    /(?:what|which)\s*(?:games?|bets?|wagers?)/i,                // what games, what bets
    /(?:what|how)\s*(?:do\s*)?(?:you|u)\s*(?:do|offer|play)/i,   // what do you do, how do you play
    /(?:what|how)\s*(?:are\s*)?(?:the|your)\s*(?:rules?|terms?)/i, // what are the rules
    /(?:what|how)\s*(?:much|min|max|limits?)/i,                  // what's the min, how much
    /(?:can\s*)?(?:i|we)\s*(?:bet|wager|play)/i,                 // can i bet, can we play
    /(?:explain|tell\s*me|info|information)/i,                   // explain, tell me, info
    /(?:how\s*)?(?:does|do)\s*(?:this|it)\s*work/i,              // how does this work
    /(?:what'?s?\s*)?(?:the\s*)?(?:deal|offer|setup)/i,          // what's the deal
    /(?:new\s*here|first\s*time|never\s*(?:done|tried))/i,       // new here, first time
    /(?:interested|looking\s*to|want\s*to)\s*(?:bet|play|wager)/i, // interested in betting
];

// ═══════════════════════════════════════════════════════════════════════════════
// COUNTER-OFFER PATTERNS (Phase 6 - when opponent proposes different terms)
// ═══════════════════════════════════════════════════════════════════════════════
const COUNTER_OFFER_PATTERNS = [
    // "how about" variations
    /(?:how\s*(?:'bout|about)|what\s*about)\s*(?:\$)?(\d+(?:\.\d{1,2})?)/i,  // how about 30, what about 25
    /(?:instead|rather)\s*(?:do|bet)?\s*(?:\$)?(\d+(?:\.\d{1,2})?)/i,        // instead 30, rather bet 25
    /(?:make\s*it|do|let'?s?\s*(?:do|go)|bet)\s*(?:\$)?(\d+(?:\.\d{1,2})?)/i, // make it 30, do 25, lets do 20, bet 20
    /(?:can\s*we?|could\s*we?)\s*(?:do|bet|go)?\s*(?:\$)?(\d+(?:\.\d{1,2})?)/i, // can we do 30
    /(?:i(?:'d|'ll|\s*would))\s*(?:prefer|rather|want)\s*(?:\$)?(\d+(?:\.\d{1,2})?)/i, // i'd prefer 30
    /(?:actually|nah|naw)\s*.*?(?:\$)?(\d+(?:\.\d{1,2})?)/i,        // actually make it 20, nah 25
    /(?:\$)?(\d+(?:\.\d{1,2})?)\s*(?:instead|better|works?\s*better)/i,       // 30 instead, 25 works better
    /(?:counter|offer)\s*(?:\$)?(\d+(?:\.\d{1,2})?)/i,                       // counter 30, offer 25
    /(?:bump|raise|lower)\s*(?:it\s*)?(?:to)?\s*(?:\$)?(\d+(?:\.\d{1,2})?)/i, // bump it to 30, lower to 20
    /^(?:it'?s?|that'?s?|do)\s*(?:\$)?(\d+(?:\.\d{1,2})?)$/i,                // it's 20, do 30
    /^\$?(\d+(?:\.\d{1,2})?)$/i,                                             // $30, 25
    /^\$?(\d+(?:\.\d{1,2})?)\s*(?:bucks|usd|dollars|dice|bet|betting|sol|btc|bitcoin|ltc|litecoin)?$/i,   // 30 bucks, 10 dice, 10 sol
    /\$(\d+(?:\.\d{1,2})?)\s*(?:dice|bet|usd|sol|btc|ltc)/i,                               // $1 dice anywhere in message
    /\b(\d+(?:\.\d{1,2})?)\s*(?:dice|bet|usd|sol|btc|ltc)\b/i,                            // 1 dice (no dollar sign) anywhere
];

/**
 * Extract bet amounts from a message
 * @param {string} message - Message to parse
 * @returns {{ opponent: number, calculated: number } | null}
 */
function extractBetAmounts(message) {
    const lower = message.toLowerCase();
    let currency = null;

    // Detect currency from message
    if (lower.includes('sol')) currency = 'SOL';
    else if (lower.includes('btc') || lower.includes('bitcoin')) currency = 'BTC';
    else if (lower.includes('ltc') || lower.includes('litecoin')) currency = 'LTC';

    // 1. Try XvX format (High Confidence)
    const vMatch = message.match(BET_PATTERN);
    if (vMatch) {
        return {
            opponent: parseFloat(vMatch[1]),
            raw: { amount1: parseFloat(vMatch[1]), amount2: parseFloat(vMatch[2]) },
            currency
        };
    }

    // 2. Try Counter-Offer patterns (proposing a single amount)
    const co = detectCounterOffer(message);
    if (co) {
        return {
            opponent: co.amount,
            raw: { amount1: co.amount },
            currency
        };
    }

    // 3. Fallback for word numbers (ten, twenty, fifty)
    const words = message.toLowerCase().trim().split(/\s+/);
    const wordNums = { 'one': 1, 'five': 5, 'ten': 10, 'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50 };
    for (const word of words) {
        if (wordNums[word]) {
            return {
                opponent: wordNums[word],
                raw: { amount1: wordNums[word] },
                currency
            };
        }
    }

    return null;
}

/**
 * Validate a cryptocurrency address
 * @param {string} address - Address to validate
 * @param {string} network - 'LTC', 'SOL', or 'BTC'
 * @returns {boolean}
 */
function isValidCryptoAddress(address, network) {
    const pattern = CRYPTO_PATTERNS[network.toUpperCase()];
    if (!pattern) return false;
    return pattern.test(address.trim());
}

/**
 * Extract crypto address from message
 * @param {string} message - Message to parse
 * @param {string} network - 'LTC', 'SOL', or 'BTC'
 * @returns {string | null}
 */
function extractCryptoAddress(message, network) {
    if (!message || typeof message !== 'string') return null;
    const pattern = CRYPTO_PATTERNS[network.toUpperCase()];
    if (!pattern) return null;

    // Split message into words and find matching address
    // Broadened: Handle prefixes like "Address:" or "LTC:"
    // CRITICAL: Strip backticks from entire message first (Discord code formatting)
    const cleanMessage = message.replace(/`/g, '');
    const words = cleanMessage.split(/\s+/);
    for (const word of words) {
        // Broadened: Remove common prefixes and punctuation
        const cleaned = word.replace(/^.*[:=-]/, '').replace(/[`<>.,;:"'!?()[\]{}]/g, '');
        if (pattern.test(cleaned)) {
            return cleaned;
        }
    }
    return null;
}

/**
 * Check if message indicates game start and extract first player
 * @param {string} message - Message to parse
 * @returns {{ userId: string } | null}
 */
function extractGameStart(message) {
    const lower = message.toLowerCase();

    // Explicit keywords check (Item 5)
    const hasKeyword = GAME_START_KEYWORDS.some(k => lower.includes(k));

    let match = message.match(GAME_START_PATTERN);
    if (!match && !hasKeyword) {
        match = message.match(GAME_START_FALLBACK);
    }

    if (!match && !hasKeyword) return null;

    // Extract userId/username if possible
    const userId = match ? match[1] : null;
    const username = match ? match[2] : null;

    // Detect if bot goes first
    const botId = process.env.CLIENT_ID || '';
    const isBotMentioned = (botId && (lower.includes(`<@${botId}>`) || lower.includes(`<@!${botId}>`)));
    const botKeywords = ['bot first', 'you first', 'you go first', 'you go', 'bot goes first', 'he win ties'];
    const firstIsBot = isBotMentioned || botKeywords.some(k => lower.includes(k));

    return {
        userId: userId || null,
        username: username || null,
        botFirst: firstIsBot
    };
}

/**
 * Extract dice result from message
 * @param {string} message - Message to parse
 * @returns {number | null}
 */
function extractDiceResult(message) {
    const match = message.match(DICE_RESULT_PATTERN);
    if (!match) return null;
    return parseInt(match[1], 10);
}

/**
 * Check if message confirms payment
 * @param {string} message - Message to check
 * @returns {boolean}
 */
function isPaymentConfirmation(message) {
    return PAYMENT_CONFIRM_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Check if message contains cancellation keywords
 * @param {string} message - Message to check
 * @returns {boolean}
 */
function isCancellation(message) {
    const keywords = config.cancellation_keywords || ['void', 'cancel', 'refund', 'reset'];
    const lower = message.toLowerCase();
    return keywords.some(k => lower.includes(k.toLowerCase()));
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTELLIGENT PATTERN HELPER FUNCTIONS (Master Prompt REQ 2)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if message is an affirmative confirmation (yes, ok, bet, etc.)
 * @param {string} message - Message to check
 * @returns {boolean}
 */
function isConfirmation(message) {
    const cleaned = message.trim().toLowerCase().replace(/[.,!?]+$/, '');
    return CONFIRM_PATTERNS.some(pattern => pattern.test(cleaned));
}

/**
 * Check if message is a rejection/negative response (no, nah, wait, etc.)
 * @param {string} message - Message to check
 * @returns {boolean}
 */
function isRejection(message) {
    const cleaned = message.trim().toLowerCase().replace(/[.,!?]+$/, '');
    return DECLINE_PATTERNS.some(pattern => pattern.test(cleaned));
}

/**
 * Check if message is ambiguous and needs clarification
 * @param {string} message - Message to check
 * @returns {boolean}
 */
function isAmbiguous(message) {
    const cleaned = message.trim().toLowerCase().replace(/[.,!?]+$/, '');
    return AMBIGUOUS_PATTERNS.some(pattern => pattern.test(cleaned));
}

/**
 * Check if message contains a game start signal
 * @param {string} message - Message to check
 * @returns {boolean}
 */
function isGameStartSignal(message) {
    const lower = message.toLowerCase();
    return GAME_START_SIGNALS.some(signal => lower.includes(signal));
}

/**
 * Check if message indicates it's the bot's turn
 * @param {string} message - Message to check
 * @returns {boolean}
 */
function isTurnIndicator(message) {
    return TURN_INDICATORS.some(pattern => pattern.test(message));
}

/**
 * Check if message is an info request (asking about bets/games)
 * @param {string} message - Message to check
 * @returns {boolean}
 */
function isInfoRequest(message) {
    return INFO_REQUEST_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Detect counter-offer and extract the proposed amount
 * @param {string} message - Message to check
 * @returns {{ amount: number } | null}
 */
function detectCounterOffer(message) {
    const lower = message.toLowerCase();
    let currency = null;

    // Detect currency from message
    if (lower.includes('sol')) currency = 'SOL';
    else if (lower.includes('ltc') || lower.includes('litecoin')) currency = 'LTC';

    for (const pattern of COUNTER_OFFER_PATTERNS) {
        const match = message.match(pattern);
        if (match) {
            // The amount is in the first capture group
            const amount = parseFloat(match[1]);
            if (!isNaN(amount) && amount > 0) {
                return { amount, currency };
            }
        }
    }
    return null;
}

/**
 * Check if message is a Dyno/ticket bot notification about ticket creation
 * @param {string} message - Message to check
 * @returns {boolean}
 */
function isDynoTicketNotification(message) {
    return DYNO_TICKET_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Check if message mentions an advertisement
 * @param {string} message - Message to check
 * @returns {boolean}
 */
function isAdReference(message) {
    return AD_REFERENCE_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Check if message contains vouch/thanks keywords
 * @param {string} message - Message to check
 * @returns {boolean}
 */
function isVouchKeyword(message) {
    return VOUCH_KEYWORDS.some(pattern => pattern.test(message));
}

module.exports = {
    BET_PATTERN,
    CRYPTO_PATTERNS,
    GAME_START_PATTERN,
    DICE_RESULT_PATTERN,
    CONFIRM_PATTERNS,
    DECLINE_PATTERNS,
    AMBIGUOUS_PATTERNS,
    GAME_START_SIGNALS,
    TURN_INDICATORS,
    WIN_PATTERNS,
    LOSS_PATTERNS,
    INFO_REQUEST_PATTERNS,
    COUNTER_OFFER_PATTERNS,
    DYNO_TICKET_PATTERNS,
    AD_REFERENCE_PATTERNS,
    VOUCH_KEYWORDS,
    extractBetAmounts,
    isValidCryptoAddress,
    extractCryptoAddress,
    extractGameStart,
    extractDiceResult,
    isPaymentConfirmation,
    isCancellation,
    isConfirmation,
    isRejection,
    isAmbiguous,
    isGameStartSignal,
    isTurnIndicator,
    isInfoRequest,
    detectCounterOffer,
    isDynoTicketNotification,
    isAdReference,
    isVouchKeyword
};
