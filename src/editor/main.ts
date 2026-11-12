/** Browser entry point: the bundle esbuild produces for the editor page. */
import { start } from "./app.js";

// A first visit opens on the games: choosing one is the first step.
start(undefined, { firstScreen: "games" });
