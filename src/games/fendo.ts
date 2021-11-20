import { GameBase, IAPGameState, IIndividualState } from "./_base";
import { APGamesInformation } from "../schemas/gameinfo";
import { APRenderRep } from "@abstractplay/renderer/src/schema";
import { APMoveResult } from "../schemas/moveresults";
import { Directions, OppositeDirections, RectGrid, reviver, UserFacingError } from "../common";
import i18next from "i18next";
import { SquareOrthGraph } from "../common/graphs";
// tslint:disable-next-line: no-var-requires
const deepclone = require("rfdc/default");

const clonelst = (items: any) => items.map((item: any) => Array.isArray(item) ? clonelst(item) : item);

const gameDesc:string = `# Fendo

In Fendo, players manoeuvre their pieces to build fences, eventually creating closed off areas that hopefully only they control. Once all the pieces are isolated, the player who controls the most area wins.
`;

export type playerid = 1|2;

export interface IAreas {
    open: Set<string>[];
    closed: Set<string>[];
    empty: Set<string>[];
}

export interface IMoveState extends IIndividualState {
    currplayer: playerid;
    board: Map<string, playerid>;
    lastmove?: string;
    pieces: [number, number];
    fences: [string, string][];
};

export interface IFendoState extends IAPGameState {
    winner: playerid[];
    stack: Array<IMoveState>;
};

export class FendoGame extends GameBase {
    public static readonly gameinfo: APGamesInformation = {
        name: "Fendo",
        uid: "fendo",
        playercounts: [2],
        version: "20211119",
        description: gameDesc,
        urls: ["https://spielstein.com/games/fendo", "https://boardgamegeek.com/boardgame/159333/fendo"],
        people: [
            {
                type: "designer",
                name: "Dieter Stein",
                urls: ["https://spielstein.com/"]
            }
        ],
        flags: ["limited-pieces", "scores", "automove"]
    };

    public numplayers: number = 2;
    public currplayer: playerid = 1;
    public board!: Map<string, playerid>;
    public pieces!: [number, number];
    public fences!: [string, string][];
    public lastmove?: string;
    public graph!: SquareOrthGraph;
    public gameover: boolean = false;
    public winner: playerid[] = [];
    public variants: string[] = [];
    public stack!: Array<IMoveState>;
    public results: Array<APMoveResult> = [];

    constructor(state?: IFendoState | string, variants?: string[]) {
        super();
        if (state === undefined) {
            const fresh: IMoveState = {
                _version: FendoGame.gameinfo.version,
                _results: [],
                currplayer: 1,
                board: new Map([["a4", 1], ["g4", 2]]),
                pieces: [7, 7],
                fences: []
            };
            this.stack = [fresh];
        } else {
            if (typeof state === "string") {
                state = JSON.parse(state, reviver) as IFendoState;
            }
            if (state.game !== FendoGame.gameinfo.uid) {
                throw new Error(`The Fendo engine cannot process a game of '${state.game}'.`);
            }
            this.gameover = state.gameover;
            this.winner = [...state.winner];
            this.variants = state.variants;
            this.stack = [...state.stack];
        }
        this.load();
    }

    public load(idx: number = -1): FendoGame {
        if (idx < 0) {
            idx += this.stack.length;
        }
        if ( (idx < 0) || (idx >= this.stack.length) ) {
            throw new Error("Could not load the requested state from the stack.");
        }

        const state = this.stack[idx];
        this.currplayer = state.currplayer;
        this.board = new Map(state.board);
        this.lastmove = state.lastmove;
        this.pieces = [...state.pieces];
        this.fences = clonelst(state.fences);
        this.buildGraph();
        return this;
    }

    private buildGraph(): FendoGame {
        this.graph = new SquareOrthGraph(7, 7);
        for (const fence of this.fences) {
            this.graph.graph.dropEdge(...fence);
        }
        return this;
    }

    public moves(player?: playerid): string[] {
        if (this.gameover) { return []; }
        if (player === undefined) {
            player = this.currplayer;
        }

        const moves: string[] = [];
        const areas = this.getAreas();
        if (areas.open.length > 1) {
            throw new Error("There should never be more than one open area.");
        }
        const open = areas.open[0];

        // Get a list of valid moves for all your pieces in the open area
        // We will use this list for both move types
        const mypieces = [...this.board.entries()].filter(e => (e[1] === player) && (open.has(e[0]))).map(e => e[0]);
        const empties = [...open].filter(cell => ! this.board.has(cell));
        const validTargets: Map<string, string[]> = new Map();
        for (const piece of mypieces) {
            for (const target of empties) {
                let path = this.naivePath(piece, target);
                if (path === null) {
                    path = this.graph.path(piece, target);
                }
                if (path !== null) {
                    // Path can't have more than one turn, nor can it contain any pieces except the first one
                    if ( (this.countTurns(path) <= 1) && ([...this.board.keys()].filter(cell => path!.includes(cell)).length === 1) ) {
                        if (validTargets.has(piece)) {
                            const lst = validTargets.get(piece)!;
                            validTargets.set(piece, [...lst, target]);
                        } else {
                            validTargets.set(piece, [target]);
                        }
                    }
                }
            }
        }
        const uniqueTargets: Set<string> = new Set(...validTargets.values());

        // You can enter a piece into the open area within one move of a friendly piece
        if (this.pieces[player - 1] > 0) {
            moves.push(...uniqueTargets);
        }

        // You can move a piece then place a fence
        for (const [from, targets] of validTargets.entries()) {
            for (const target of targets) {
                // Neighbours obviously don't have a fence between them, so you could place one there
                const neighbours = this.graph.neighbours(target);
                for (const n of neighbours) {
                    // Make the move, set the fence, and test that the result is valid
                    const cloned: FendoGame = Object.assign(new FendoGame(), deepclone(this));
                    cloned.buildGraph();
                    cloned.board.delete(from);
                    cloned.board.set(target, player);
                    cloned.graph.graph.dropEdge(target, n);
                    const clonedAreas = cloned.getAreas();
                    if ( (clonedAreas.empty.length === 0) && (clonedAreas.open.length <= 1) ) {
                        const bearing = this.graph.bearing(target, n);
                        moves.push(`${from}-${target}${bearing}`)
                    }
                }
            }
        }

        if (moves.length === 0) {
            moves.push("pass");
        }

        return moves;
    }

    /**
     * Just tries the two possible T-shape moves.
     * This is necessary because the shortest path in a wide-open map may have more turns than strictly necessary.
     * And the `allSimplePaths` method takes *far* too long with a large area early in the game.
     *
     * @private
     * @param {string} from
     * @param {string} to
     * @returns {(string[] | null)}
     * @memberof FendoGame
     */
    public naivePath(from: string, to: string): string[] | null {
        const grid = new RectGrid(7, 7);
        const dirs: Directions[] = [];
        const [xFrom, yFrom] = this.graph.algebraic2coords(from);
        const [xTo, yTo] = this.graph.algebraic2coords(to);
        if (xTo > xFrom) {
            dirs.push("E");
        } else if (xTo < xFrom) {
            dirs.push("W");
        }
        if (yTo > yFrom) {
            dirs.push("S");
        } else if (yTo < yFrom) {
            dirs.push("N");
        }
        // If you passed the same cell as from and to, return null
        if (dirs.length === 0) {
            return null;
        }
        // If we're on a straight line, just cast a ray and test the edges
        if (dirs.length === 1) {
            const ray = grid.ray(xFrom, yFrom, dirs[0]).map(pt => this.graph.coords2algebraic(...pt));
            const toidx = ray.findIndex(cell => cell === to);
            if (toidx < 0) {
                throw new Error("Could not find the target cell when ray casting.");
            }
            const path = [from, ...ray.slice(0, toidx + 1)];
            for (let i = 0; i < path.length - 1; i++) {
                if (! this.graph.graph.hasEdge(path[i], path[i+1])) {
                    return null;
                }
            }
            return path;
        }
        // Otherwise, test both combinations of dirs to build a path and test it
        const reversed = [...dirs].reverse();
        for (const pair of [dirs, reversed]) {
            // Cast a ray from `from` in the first direction
            const ray1 = grid.ray(xFrom, yFrom, pair[0]).map(pt => this.graph.coords2algebraic(...pt));
            // Cast a ray from to in the opposite of the second direction
            const opposite = OppositeDirections.get(pair[1])!;
            const ray2 = grid.ray(xTo, yTo, opposite).map(pt => this.graph.coords2algebraic(...pt));
            // Find the intersection point
            const intersection = ray1.filter(cell => ray2.includes(cell));
            if (intersection.length !== 1) {
                throw new Error("Rays did not intersect.");
            }
            // Merge the paths
            const idx1 = ray1.findIndex(cell => cell === intersection[0]);
            const idx2 = ray2.findIndex(cell => cell === intersection[0]);
            const path = [from, ...ray1.slice(0, idx1), intersection[0], ...ray2.slice(0, idx2).reverse(), to];
            // Test
            let valid = true;
            for (let i = 0; i < path.length - 1; i++) {
                if (! this.graph.graph.hasEdge(path[i], path[i+1])) {
                    valid = false;
                    break;
                }
            }
            if (valid) {
                return path;
            }
        }

        return null;
    }

    private countTurns(cells: string[]): number {
        let turns = 0;
        let last: number | undefined;
        for (let i = 0; i < cells.length - 1; i++) {
            const [xFrom,] = this.graph.algebraic2coords(cells[i]);
            const [xTo,] = this.graph.algebraic2coords(cells[i+1]);
            const dx = xTo - xFrom;
            if (last === undefined) {
                last = dx;
            } else if (last !== dx) {
                turns++;
                last = dx;
            }
        }
        return turns;
    }

    public getAreas(): IAreas {
        const areas: IAreas = {
            open: [],
            closed: [],
            empty: []
        };
        const seen: Set<string> = new Set();
        let remainingCells = this.graph.listCells(false) as string[];
        while (remainingCells.length > 0) {
            const start = remainingCells.pop()!;
            const area: Set<string> = new Set();
            const todo = [start];
            while (todo.length > 0) {
                const next = todo.pop()!;
                if (seen.has(next)) {
                    continue;
                }
                seen.add(next);
                area.add(next);
                todo.push(...this.graph.neighbours(next));
            }
            // At this point, we have an area based on `start`
            // Classify it
            const pieces = [...this.board.entries()].filter(e => area.has(e[0]));
            if (pieces.length === 0) {
                areas.empty.push(area);
            } else if (pieces.length === 1) {
                areas.closed.push(area);
            } else {
                areas.open.push(area);
            }
            // Remove all these cells from consideration in future areas
            remainingCells = remainingCells.filter(cell => ! area.has(cell));
        }
        return areas;
    }

    public randomMove(): string {
        const moves = this.moves();
        return moves[Math.floor(Math.random() * moves.length)];
    }

    // Will need to be made aware of the different board types
    public click(row: number, col: number, piece: string): string {
        if (piece === '')
            return String.fromCharCode(97 + col) + (8 - row).toString();
        else
            return 'x' + String.fromCharCode(97 + col) + (8 - row).toString();
    }

    public clicked(move: string, coord: string): string {
        if (move.length > 0 && move.length < 3) {
            if (coord.length === 2)
                return move + '-' + coord;
            else
                return move + coord;
        }
        else {
            if (coord.length === 2)
                return coord;
            else
                return coord.substring(1, 3);
        }
    }

    public move(m: string): FendoGame {
        if (this.gameover) {
            throw new UserFacingError("MOVES_GAMEOVER", i18next.t("apgames:MOVES_GAMEOVER"));
        }
        m = m.toLowerCase();
        m = m.replace(/\s+/g, "");
        if (m !== "pass") {
            m = m.replace(/[a-z]+$/, (match) => {return match.toUpperCase();});
        }
        if (! this.moves().includes(m)) {
            throw new UserFacingError("MOVES_INVALID", i18next.t("apgames:MOVES_INVALID", {move: m}));
        }

        this.results = [];
        // Always check for a pass
        if (m === "pass") {
            this.results.push({type: "pass"});
        // Now look for movement
        } else if (m.includes("-")) {
            const [from, target] = m.split("-");
            const to = target.slice(0, target.length - 1);
            const dir = target[target.length - 1] as Directions;
            let path = this.naivePath(from, to);
            if (path === null) {
                path = this.graph.path(from, to);
            }
            this.board.delete(from);
            this.board.set(to, this.currplayer);
            const neighbour = this.graph.coords2algebraic(...RectGrid.move(...this.graph.algebraic2coords(to), dir));
            this.fences.push([to, neighbour]);
            this.graph.graph.dropEdge(to, neighbour);
            for (let i = 0; i < path!.length - 1; i++) {
                this.results.push({type: "move", from: path![i], to: path![i+1]});
            }
            this.results.push({type: "block", between: [to, neighbour]});
        // Otherwise it's placement
        } else {
            this.board.set(m, this.currplayer);
            this.pieces[this.currplayer - 1]--;
            this.results.push({type: "place", where: m})
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

    protected checkEOG(): FendoGame {
        // If two passes in a row, we need to end
        let passedout = false;
        if ( (this.lastmove === "pass") && (this.stack[this.stack.length - 1].lastmove === "pass") ) {
            passedout = true;
        }
        // If no more open areas, tally up
        const areas = this.getAreas();
        if ( (areas.open.length === 0) || (passedout) ) {
            this.gameover = true;
            const score1 = this.getPlayerScore(1);
            const score2 = this.getPlayerScore(2);
            if (score1 > score2) {
                this.winner = [1];
            } else if (score1 < score2) {
                this.winner = [2];
            } else {
                this.winner = [1, 2];
            }
            this.results.push(
                {type: "eog"},
                {type: "winners", players: [...this.winner]}
            );
        }

        return this;
    }

    public resign(player: playerid): FendoGame {
        this.gameover = true;
        if (player === 1) {
            this.winner = [2];
        } else {
            this.winner = [1];
        }
        this.results = [
            {type: "resigned", player},
            {type: "eog"},
            {type: "winners", players: [...this.winner]}
        ];
        this.saveState();
        return this;
    }

    public state(): IFendoState {
        return {
            game: FendoGame.gameinfo.uid,
            numplayers: this.numplayers,
            variants: this.variants,
            gameover: this.gameover,
            winner: [...this.winner],
            stack: [...this.stack]
        };
    }

    public moveState(): IMoveState {
        return {
            _version: FendoGame.gameinfo.version,
            _results: [...this.results],
            currplayer: this.currplayer,
            lastmove: this.lastmove,
            board: new Map(this.board),
            pieces: [...this.pieces],
            fences: clonelst(this.fences),
        };
    }

    public render(): APRenderRep {
        // Build piece string
        let pstr: string = "";
        const cells = this.graph.listCells(true);
        for (const row of cells) {
            if (pstr.length > 0) {
                pstr += "\n";
            }
            const pieces: string[] = [];
            for (const cell of row) {
                if (this.board.has(cell)) {
                    const contents = this.board.get(cell)!;
                    if (contents === 1) {
                        pieces.push("A");
                    } else {
                        pieces.push("B")
                    }
                } else {
                    pieces.push("-");
                }
            }
            pstr += pieces.join("");
        }

        // Build rep
        const markers: any[] = [];
        // First add fences
        for (const fence of this.fences) {
            const dir = this.graph.bearing(fence[0], fence[1]);
            const [x, y] = this.graph.algebraic2coords(fence[0]);
            markers.push({type: "fence", cell: {row: y, col: x}, side: dir});
        }
        // Now shade in closed areas
        const areas = this.getAreas();
        for (const area of areas.closed) {
            const owner = [...this.board.entries()].filter(e => area.has(e[0])).map(e => e[1])[0];
            for (const cell of area) {
                const [x, y] = this.graph.algebraic2coords(cell);
                markers.push({type: "shading", points: [{col: x, row: y}, {col: x+1, row: y}, {col: x+1, row: y+1}, {col: x, row: y+1}], colour: owner})
            }
        }

        const board = {
            style: "squares-beveled",
            width: 7,
            height: 7,
            markers,
        }
        const rep: APRenderRep =  {
            // @ts-ignore
            board,
            legend: {
                A: {
                    name: "piece",
                    player: 1
                },
                B: {
                    name: "piece",
                    player: 2
                }
            },
            pieces: pstr
        };

        // Add annotations
        if (this.stack[this.stack.length - 1]._results.length > 0) {
            // @ts-ignore
            rep.annotations = [];
            for (const move of this.stack[this.stack.length - 1]._results) {
                if (move.type === "move") {
                    const [fromX, fromY] = this.graph.algebraic2coords(move.from);
                    const [toX, toY] = this.graph.algebraic2coords(move.to);
                    rep.annotations!.push({type: "move", targets: [{row: fromY, col: fromX}, {row: toY, col: toX}]});
                } else if (move.type === "place") {
                    const [x, y] = this.graph.algebraic2coords(move.where!);
                    rep.annotations!.push({type: "enter", targets: [{row: y, col: x}]});
                }
            }
            if (rep.annotations!.length === 0) {
                delete rep.annotations;
            }
        }

        return rep;
    }

    public status(): string {
        let status = super.status();

        if (this.variants !== undefined) {
            status += "**Variants**: " + this.variants.join(", ") + "\n\n";
        }

        status += "**Pieces In Hand**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            const pieces = this.pieces[n - 1];
            status += `Player ${n}: ${pieces}\n\n`;
        }

        status += "**Scores**\n\n";
        for (let n = 1; n <= this.numplayers; n++) {
            status += `Player ${n}: ${this.getPlayerScore(n as playerid)}\n\n`;
        }

        return status;
    }

    protected getVariants(): string[] | undefined {
        if ( (this.variants === undefined) || (this.variants.length === 0) ) {
            return undefined;
        }
        const vars: string[] = [];
        for (const v of this.variants) {
            for (const rec of FendoGame.gameinfo.variants!) {
                if (v === rec.uid) {
                    vars.push(rec.name);
                    break;
                }
            }
        }
        return vars;
    }

    protected getMoveList(): any[] {
        return this.getMovesAndResults(["move", "place"]);
    }

    public getPlayerPieces(player: number): number {
        return this.pieces[player - 1];
    }

    public getPlayerScore(player: number): number {
        let score = 0;

        const areas = this.getAreas();
        for (const area of areas.closed) {
            const pieces = [...this.board.entries()].filter(e => (area.has(e[0]) && (e[1] === player)));
            if (pieces.length > 0) {
                score += area.size;
            }
        }

        return score;
    }

    public chatLog(players: string[]): string[][] {
        // eog, resign, winners, place, move
        const result: string[][] = [];
        for (const state of this.stack) {
            if ( (state._results !== undefined) && (state._results.length > 0) ) {
                const node: string[] = [];
                let otherPlayer = state.currplayer + 1;
                if (otherPlayer > this.numplayers) {
                    otherPlayer = 1;
                }
                let name: string = `Player ${otherPlayer}`;
                if (otherPlayer <= players.length) {
                    name = players[otherPlayer - 1];
                }

                const moves = state._results.filter(r => r.type === "move");
                if (moves.length > 0) {
                    const first = moves[0];
                    const last = moves[moves.length - 1];
                    const rest = moves.slice(0, moves.length - 1);
                    if ( moves.length > 2) {
                        // @ts-ignore
                        node.push(i18next.t("apresults:MOVE.chase", {player: name, from: first.from, to: last.to, through: rest.map(r => r.to).join(", ")}));
                    } else {
                        // @ts-ignore
                        node.push(i18next.t("apresults:MOVE.nowhat", {player: name, from: first.from, to: last.to}));
                    }
                }

                for (const r of state._results) {
                    switch (r.type) {
                        case "place":
                            node.push(i18next.t("apresults:PLACE.nowhat", {player: name, where: r.where}));
                            break;
                        case "block":
                            node.push(i18next.t("apresults:BLOCK.between", {player: name, cell1: r.between![0], cell2: r.between![1]}));
                            break;
                        case "pass":
                            node.push(i18next.t("apresults:PASS.simple", {player: name}));
                            break;
                        case "eog":
                            node.push(i18next.t("apresults:EOG"));
                            break;
                            case "resigned":
                                let rname = `Player ${r.player}`;
                                if (r.player <= players.length) {
                                    rname = players[r.player - 1]
                                }
                                node.push(i18next.t("apresults:RESIGN", {player: rname}));
                                break;
                            case "winners":
                                const names: string[] = [];
                                for (const w of r.players) {
                                    if (w <= players.length) {
                                        names.push(players[w - 1]);
                                    } else {
                                        names.push(`Player ${w}`);
                                    }
                                }
                                node.push(i18next.t("apresults:WINNERS", {count: r.players.length, winners: names.join(", ")}));
                                break;
                        }
                }
                result.push(node);
            }
        }
        return result;
    }

    public clone(): FendoGame {
        return new FendoGame(this.serialize());
    }
}
