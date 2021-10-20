import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { RectGrid } from "../common";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { Directions } from "../common";
import { APMoveResult } from "../schemas/moveresults";
// tslint:disable-next-line: no-var-requires
const clone = require("rfdc/default");

const gameDesc:string = `# Blam!

An Icehouse game for 2–4 players played on a standard chess board. Pieces placed push adjacent pieces away. Push pieces off the board to capture them. Whoever has captured the highest pip total of pieces at the end of the game wins.
`;

export type playerid = 1|2|3|4;

interface ILooseObj {
    [key: string]: any;
}

interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, [playerid, number]>;
    lastmove?: string;
    scores: number[];
    caps: number[];
    stashes: Map<playerid, number[]>;
}

export interface IBlamState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class BlamGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Blam!",
        uid: "blam",
        playercounts: [2,3,4],
        version: "20211009",
        description: gameDesc,
        urls: ["http://invisible-city.com/content/blam"],
        people: [
            {
                type: "designer",
                name: "Jon Eargle"
            }
        ],
    };
        // variants: [
        //     {
        //         uid: "overloaded",
        //         name: "Overloaded",
        //         description: "Placed pieces push adjacent pieces a number of spaces equal to their pip counts"
        //     }
        // ]

    public static coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, 8);
    }
    public static algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, 8);
    }

    public numplayers!: number;
    public currplayer!: playerid;
    public board!: Map<string, [playerid, number]>;
    public lastmove?: string;
    public gameover: boolean = false;
    public winner: playerid[] = [];
    public variants?: string[];
    public scores!: number[];
    public caps!: number[];
    public stashes!: Map<playerid, number[]>;
    public stack: Array<IMoveState>;
    public results: Array<APMoveResult> = []

    constructor(state: number | IBlamState, variants?: string[]) {
        super();
        if (typeof state === "number") {
            this.numplayers = state;
            const fresh: IMoveState = {
                _version: BlamGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board: new Map(),
                scores: [],
                caps: [],
                stashes: new Map()
            };
            if ( (variants !== undefined) && (variants.length === 1) && (variants[0] === "overloaded") ) {
                this.variants = ["overloaded"];
            }
            for (let pid = 1; pid <= state; pid++) {
                fresh.scores.push(0);
                fresh.caps.push(0);
                fresh.stashes.set(pid as playerid, [5,5,5]);
            }
            this.stack = [fresh];
        } else {
            if (state.game !== BlamGame.gameinfo.uid) {
                throw new Error(`The Blam! game code cannot process a game of '${state.game}'.`);
            }
            this.numplayers = state.numplayers;
            this.variants = state.variants;
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx: number = -1): void {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.stashes = clone(state.stashes);
        this.lastmove = state.lastmove;
        this.scores = [...state.scores];
        this.caps = [...state.caps];
}

    public moves(player?: playerid): string[] {
        if (player === undefined) {
            player = this.currplayer;
        }
        // What pieces can the player place?
        const pieces: number[] = [];
        const stash = this.stashes.get(player);
        if ( (stash === undefined) || (stash.length !== 3) ) {
            throw new Error("Malformed stash. This should never happen.");
        }
        [0, 1, 2].forEach((n) => {
            if (stash[n] > 0) {
                pieces.push(n + 1);
            }
        });

        if (pieces.length === 0) {
            return ["pass"];
        }

        const cells: string[] = [];
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const cell = BlamGame.coords2algebraic(col, row);
                if (! this.board.has(cell)) {
                    cells.push(cell);
                }
            }
        }

        const moves: string[] = [];
        pieces.forEach((piece) => {
            cells.forEach((cell) => {
                moves.push(piece.toString() + cell)
            });
        });
        return moves;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    public move(m: string): BlamGame {
        if (m.toLowerCase() === "pass") {
            // validate move
            const stash = this.stashes.get(this.currplayer);
            if ( (stash === undefined) || (stash.length !== 3)) {
                throw new Error("Malformed stash. This should never happen.");
            }
            const sum = stash.reduce((a, b) => {return a + b;});
            if (sum > 0) {
                throw new Error(`Invalid move: ${m}. You can't pass if you have pieces to place.`);
            }
            this.results = [{type: "pass"}];
        } else {
            // validate move
            const chars = m.split("");
            const pip = parseInt(chars[0], 10);
            if ( (pip === undefined) || (pip === null) || (pip < 1) || (pip > 3) ) {
                throw new Error(`Invalid move: ${m}. The pip value is not valid.`);
            }
            const stash = this.stashes.get(this.currplayer);
            if ( (stash === undefined) || (stash.length !== 3)) {
                throw new Error("Malformed stash. This should never happen.");
            }
            if (stash[pip - 1] <= 0) {
                throw new Error(`Invalid move: ${m}. The player does not have a piece of that size to place.`);
            }
            const cell = chars[1] + chars[2];
            const coords = BlamGame.algebraic2coords(cell);
            const grid = new RectGrid(8, 8);
            if (! grid.inBounds(...coords)) {
                throw new Error(`Invalid move: ${m}. The cell is not on the board.`);
            }
            if (this.board.has(cell)) {
                throw new Error(`Invalid move: ${m}. The cell is already occupied.`);
            }

            // place the piece
            this.board.set(cell, [this.currplayer, pip]);
            stash[pip - 1]--;
            this.stashes.set(this.currplayer, stash);
            this.results = [{type: "place", location: cell, piece: pip.toString()}]

            // Look in each direction for adjacent pieces and recursively push down the line
            const dirs: Directions[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
            dirs.forEach((d) => {
                const adj = RectGrid.move(...coords, d);
                if (grid.inBounds(...adj)) {
                    this.push(adj, d);
                }
            });
        }

        // update currplayer
        this.lastmove = m;
        let newplayer = (this.currplayer as number) + 1;
        if (newplayer > this.numplayers) {
            newplayer = 1;
        }
        this.currplayer = newplayer as playerid;

        this.checkEOG();
        this.saveState();
        return this;
    }

    public push(start: [number, number], dir: Directions): void {
        let scoreDelta = 0;
        // If there's a piece here, move it, pushing anything it its way
        if (this.board.has(BlamGame.coords2algebraic(...start))) {
            // Do the recursion, and then when it returns, move the piece
            const adj = RectGrid.move(...start, dir);
            this.push(adj, dir);

            const grid = new RectGrid(8, 8);
            const cellStart = BlamGame.coords2algebraic(...start);
            const piece = this.board.get(cellStart);
            if (piece === undefined) {
                throw new Error("Trying to move a nonexistent piece. This should never happen.");
            }
            // If the next cell is in bounds, move the piece
            if (grid.inBounds(...adj)) {
                this.board.set(BlamGame.coords2algebraic(...adj), piece);
                this.board.delete(cellStart);
            // Otherwise it's off the board and is either captured or reclaimed
            } else {
                // If the piece belongs to the current player, reclaim it
                if (piece[0] === this.currplayer) {
                    const stash = this.stashes.get(this.currplayer);
                    if ( (stash === undefined) || (stash.length !== 3)) {
                        throw new Error("Malformed stash. This should never happen.");
                    }
                    stash[piece[1] - 1]++;
                    this.stashes.set(this.currplayer, stash);
                    this.results.push({type: "reclaim", piece: piece[1].toString()});
                // Otherwise, capture it (add it to the current player's score)
                } else {
                    let score = this.scores[(this.currplayer as number) - 1];
                    if (score === undefined) {
                        throw new Error("Malformed score. This should never happen.");
                    }
                    let caps = this.caps[(this.currplayer as number) - 1];
                    if (caps === undefined) {
                        throw new Error("Malformed caps. This should never happen.");
                    }
                    caps++;
                    this.caps[(this.currplayer as number) - 1] = caps;
                    this.results.push({type: "capture", piece: piece[1].toString()});
                    score += piece[1];
                    scoreDelta += piece[1];
                    this.scores[(this.currplayer as number) - 1] = score;
                }
                this.board.delete(cellStart);
            }
        }
        if (scoreDelta > 0) {
            this.results.push({type: "deltaScore", delta: scoreDelta});
        }
    }

    protected checkEOG(): BlamGame {
        for (let n = 1; n <= this.numplayers; n++) {
            const stash = this.stashes.get(n as playerid);
            if ( (stash === undefined) || (stash.length !== 3) ) {
                throw new Error("Malformed stash. This should never happen.");
            }
            const sum = stash.reduce((a, b) => {return a + b;});
            if (sum > 0) {
                return this;
            }
        }
        // If we get here, then the game is truly over
        this.gameover = true;
        this.results.push({type: "eog"});
        // Find the maximum score
        const maxscore = Math.max(...this.scores);
        // If the maxscore is unique, then we've found our winner
        const map: Map<number, number> = this.scores.reduce((acc, e) => acc.set(e, (acc.get(e) || 0) + 1), new Map());
        if (map.size === this.scores.length) {
            const n = this.scores.indexOf(maxscore);
            this.winner = [(n + 1) as playerid];
        } else {
            const nTied: playerid[] = [];
            for (let i = 0; i < this.scores.length; i++) {
                if (this.scores[i] === maxscore) {
                    nTied.push((i + 1) as playerid);
                }
            }
            const caps: number[] = [];
            for (const n of nTied) {
                caps.push(this.caps[n - 1])
            }
            const maxcaps = Math.max(...caps);
            const capmap: Map<number, number> = caps.reduce((acc, e) => acc.set(e, (acc.get(e) || 0) + 1), new Map());
            if (capmap.size === nTied.length) {
                const n = this.caps.indexOf(maxcaps);
                this.winner = [(n + 1) as playerid];
            } else {
                this.winner = [...nTied];
            }
        }
        this.results.push({type: "winners", players: [...this.winner]});

        if (this.winner === undefined) {
            throw new Error("A winner could not be determined. This should never happen.");
        }

        return this;
    }

    public resign(player: playerid): BlamGame {
        this.results = [{type: "resigned", player}]
        // If one person resigns, the others win together
        this.gameover = true;
        this.results.push({type: "eog"});
        const winners: playerid[] = [];
        for (let n = 1; n <= this.numplayers; n++) {
            if (n as playerid !== player) {
                winners.push(n as playerid);
            }
        }
        this.winner = [...winners];
        this.results.push({type: "winners", players: [...this.winner]});
        this.saveState();
        return this;
    }

    public state(): IBlamState {
        return {
            game: BlamGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: BlamGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            scores: [...this.scores],
            caps: [...this.caps],
            stashes: clone(this.stashes)
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr: string = "";
        for (let row = 0; row < 8; row++) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (let col = 0; col < 8; col++) {
                const cell = BlamGame.coords2algebraic(col, row);
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell);
                    if (contents === undefined) {
                        throw new Error("Malformed cell contents. This should never happen.");
                    }
                    pieces.push("P" + contents[0].toString() + contents[1].toString());
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join(",");
        }
        pstr = pstr.replace(/\-{8}/g, "_");

        // build legend based on number of players
        const myLegend: ILooseObj = {};
        for (let n = 1; n <= this.numplayers; n++) {
            myLegend["P" + n.toString() + "1"] = {
                name: "pyramid-up-small-upscaled",
                player: n
            };
            myLegend["P" + n.toString() + "2"] = {
                name: "pyramid-up-medium-upscaled",
                player: n
            };
            myLegend["P" + n.toString() + "3"] = {
                name: "pyramid-up-large-upscaled",
                player: n
            };
        }

        // Build rep
        const rep: APRenderRep =  {
            board: {
                style: "squares-checkered",
                width: 8,
                height: 8
            },
            legend: myLegend,
            pieces: pstr
        };

        // Add annotations
        if ( (this.lastmove !== undefined) && (this.lastmove !== "pass") ) {
            const coords = BlamGame.algebraic2coords(this.lastmove.slice(1));
            rep.annotations = [
                {
                    type: "enter",
                    targets: [
                        {col: coords[0], row: coords[1]},
                    ]
                }
            ];
        }

        return rep;
    }

    public status(): string {
        let status = "";

        status += "**Stashes**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const stash = this.stashes.get(n as playerid);
            if ( (stash === undefined) || (stash.length !== 3) ) {
                throw new Error("Malformed stash. This should never happen.");
            }
            status += `Player ${n}: ${stash[0]} small, ${stash[1]} medium, ${stash[2]} large\n\n`;
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const score = this.scores[n - 1];
            const caps = this.caps[n - 1];
            status += `Player ${n}: ${score} (${caps} pieces)\n\n`;
        }

        if (this.gameover) {
            status += "**GAME OVER**\n\n";
            const winners = this.winner;
            if (winners === undefined) {
                throw new Error("Winners should never be undefined if Gameover is true.");
            }
            status += `Winner: ${(winners.map((e) => {return e.toString();})).join(", ")}\n`;
        }

        return status;
    }
}
