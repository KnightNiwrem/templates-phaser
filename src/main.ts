import Phaser from "phaser";
import { createGameConfig } from "./config";
import { initSaveSystem } from "./save/browser";
import { publishGame } from "./state";

initSaveSystem();
const game = new Phaser.Game(createGameConfig());
publishGame(game);
