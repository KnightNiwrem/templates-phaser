import Phaser from "phaser";
import { createGameConfig } from "./config";
import { publishGame } from "./state";

const game = new Phaser.Game(createGameConfig());
publishGame(game);
