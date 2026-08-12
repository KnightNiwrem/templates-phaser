import Phaser from "phaser";
import { createGameConfig } from "./config";
import { LocalStorageBackend, persistStorage } from "./save/storage";
import { createSaveStore } from "./save/store";
import { publishGame } from "./state";

// Expose the save modules for e2e / agent tests to drive from inside the page.
// The bun build --define __PLAYWRIGHT__=false flag (see package.json's "build")
// ensures release builds tree-shake these test-only imports away.
window.__saveStore = { createSaveStore };
window.__saveStorage = { LocalStorageBackend, persistStorage };

const game = new Phaser.Game(createGameConfig());
publishGame(game);
