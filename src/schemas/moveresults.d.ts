/* tslint:disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

/**
 * Written information about changes in game state after a move are encoded as a JSON object matching this schema. The goal is to then allow localized statements to be generated from them.
 */
export type APMoveResult =
  | {
      type: "place";
      location?: string;
      piece?: string;
    }
  | {
      type: "move";
      from: string;
      to: string;
      piece?: string;
    }
  | {
      type: "capture";
      location?: string;
      piece?: string;
    }
  | {
      type: "pass";
    }
  | {
      type: "deltaScore";
      delta?: number;
    }
  | {
      type: "reclaim";
      piece?: string;
    }
  | {
      type: "block";
      location: string;
    }
  | {
      type: "eog";
      reason?: string;
    }
  | {
      type: "winners";
      players: number[];
    }
  | {
      type: "draw";
    }
  | {
      type: "resigned";
      player: number;
    }
  | {
      type: "kicked";
      player: number;
    }
  | {
      type: "promote";
      from?: string;
      to: string;
    };
