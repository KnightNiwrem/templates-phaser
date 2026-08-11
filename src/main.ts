import Phaser from "phaser";
import { createGameConfig } from "./config";
import { LocalStorageBackend, persistStorage } from "./save/storage";
import { createSaveStore } from "./save/store";
import { publishGame } from "./state";

// Expose the save modules for e2e / agent tests to drive from inside the page.
window.__saveStore = { createSaveStore };
window.__saveStorage = { LocalStorageBackend, persistStorage };

const game = new Phaser.Game(createGameConfig());
publishGame(game);
