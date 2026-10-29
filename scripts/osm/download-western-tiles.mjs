#!/usr/bin/env node
/**
 * Direct shortcut for downloading authentic Western Milan OSM tiles in a connected environment.
 */
import { downloadExpansionTiles } from "./expand-milan-network.mjs";

downloadExpansionTiles({ westernOnly: true })
  .then(() => console.log("Western Milan tiles downloaded and merged successfully."))
  .catch((err) => {
    console.error(`Download failed: ${err.message}`);
    process.exitCode = 1;
  });
