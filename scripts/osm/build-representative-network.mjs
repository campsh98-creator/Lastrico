/**
 * Builds a representative Milan road network extract containing:
 * 1. Verified historic rough stone ways (sett, cobblestone, paving_stones)
 * 2. Major asphalt and concrete thoroughfares (Corso Buenos Aires, Corso Venezia, Bastioni, etc.)
 * 3. Segregated cycle tracks with asphalt surface
 * 4. Residential streets with unmapped surface (strictly unknown)
 * 5. Roads with explicit smoothness tags
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "../..");
const paveSnapshotPath = join(rootDir, "data/milan-pave-central.json");
const outputPath = join(rootDir, "data/milan-road-network-representative.json");

export async function buildRepresentativeNetwork() {
  const rawPave = JSON.parse(await readFile(paveSnapshotPath, "utf8"));

  // Representative modern network ways in central/semi-central Milan
  const representativeWays = [
    // 1. Corso Buenos Aires (Primary thoroughfare - Asphalt, Good smoothness, Cycleway lane)
    {
      id: 20000001,
      name: "Corso Buenos Aires",
      tags: {
        highway: "primary",
        surface: "asphalt",
        smoothness: "good",
        cycleway: "lane",
        "cycleway:surface": "asphalt",
        oneway: "no",
        lanes: "4",
        maxspeed: "50",
      },
      coordinates: [
        [9.2050, 45.4740],
        [9.2075, 45.4765],
        [9.2100, 45.4790],
        [9.2130, 45.4820],
        [9.2160, 45.4850],
      ],
    },
    // 2. Corso Venezia (Primary thoroughfare - Asphalt, Good smoothness, Cycleway)
    {
      id: 20000002,
      name: "Corso Venezia",
      tags: {
        highway: "primary",
        surface: "asphalt",
        smoothness: "good",
        cycleway: "track",
        "cycleway:surface": "asphalt",
        oneway: "no",
        lanes: "4",
        maxspeed: "50",
      },
      coordinates: [
        [9.1980, 45.4670],
        [9.2005, 45.4695],
        [9.2030, 45.4720],
        [9.2050, 45.4740],
      ],
    },
    // 3. Bastioni di Porta Venezia (Secondary ring road - Asphalt, oneway eastbound)
    {
      id: 20000003,
      name: "Bastioni di Porta Venezia",
      tags: {
        highway: "secondary",
        surface: "asphalt",
        smoothness: "intermediate",
        oneway: "yes",
        lanes: "3",
      },
      coordinates: [
        [9.2035, 45.4742],
        [9.2050, 45.4740],
        [9.2070, 45.4735],
      ],
    },
    // 4. Viale Majno (Secondary ring road - Asphalt, oneway southbound)
    {
      id: 20000004,
      name: "Viale Luigi Majno",
      tags: {
        highway: "secondary",
        surface: "asphalt",
        smoothness: "good",
        oneway: "yes",
        lanes: "3",
      },
      coordinates: [
        [9.2070, 45.4735],
        [9.2078, 45.4710],
        [9.2082, 45.4680],
      ],
    },
    // 5. Viale Bianca Maria (Secondary ring road - Asphalt)
    {
      id: 20000005,
      name: "Viale Bianca Maria",
      tags: {
        highway: "secondary",
        surface: "asphalt",
        smoothness: "good",
        oneway: "yes",
        lanes: "3",
      },
      coordinates: [
        [9.2082, 45.4680],
        [9.2084, 45.4650],
        [9.2082, 45.4620],
      ],
    },
    // 6. Viale Regina Margherita (Secondary ring road - Tram tracks in asphalt)
    {
      id: 20000006,
      name: "Viale Regina Margherita",
      tags: {
        highway: "secondary",
        surface: "asphalt",
        smoothness: "intermediate",
        railway: "tram",
        embedded_rails: "yes",
        oneway: "no",
      },
      coordinates: [
        [9.2082, 45.4620],
        [9.2070, 45.4590],
        [9.2050, 45.4560],
      ],
    },
    // 7. Corso di Porta Romana (Primary/secondary - Asphalt with tramway)
    {
      id: 20000007,
      name: "Corso di Porta Romana",
      tags: {
        highway: "primary",
        surface: "asphalt",
        smoothness: "bad",
        railway: "tram",
        embedded_rails: "yes",
        oneway: "no",
      },
      coordinates: [
        [9.1900, 45.4590],
        [9.1940, 45.4565],
        [9.1980, 45.4540],
        [9.2020, 45.4520],
      ],
    },
    // 8. Via Senato (Inner ring road - Asphalt, good)
    {
      id: 20000008,
      name: "Via Senato",
      tags: {
        highway: "tertiary",
        surface: "asphalt",
        smoothness: "good",
        oneway: "yes",
      },
      coordinates: [
        [9.1990, 45.4700],
        [9.1985, 45.4685],
        [9.1980, 45.4670],
      ],
    },
    // 9. Via Fatebenefratelli (Tertiary road - Asphalt)
    {
      id: 20000009,
      name: "Via Fatebenefratelli",
      tags: {
        highway: "tertiary",
        surface: "asphalt",
        smoothness: "good",
        oneway: "yes",
      },
      coordinates: [
        [9.1920, 45.4720],
        [9.1955, 45.4710],
        [9.1990, 45.4700],
      ],
    },
    // 10. Dedicated Cycleway: Pista Ciclabile Canale Martesana (Segregated cycleway - Asphalt)
    {
      id: 20000010,
      name: "Pista Ciclabile Martesana",
      tags: {
        highway: "cycleway",
        surface: "asphalt",
        smoothness: "excellent",
        bicycle: "designated",
        foot: "designated",
        segregated: "yes",
        oneway: "no",
      },
      coordinates: [
        [9.2080, 45.4950],
        [9.2120, 45.4970],
        [9.2160, 45.4990],
        [9.2200, 45.5010],
      ],
    },
    // 11. Concrete Plaza: Piazza Gae Aulenti (Pedestrian plaza - Concrete, smooth)
    {
      id: 20000011,
      name: "Piazza Gae Aulenti",
      tags: {
        highway: "pedestrian",
        surface: "concrete",
        smoothness: "excellent",
        bicycle: "yes",
      },
      coordinates: [
        [9.1890, 45.4835],
        [9.1900, 45.4840],
        [9.1910, 45.4842],
      ],
    },
    // 12. UNTAGGED Residential Street: Via Sottocorno (NO surface tag -> Strictly UNKNOWN)
    {
      id: 20000012,
      name: "Via Pasquale Sottocorno",
      tags: {
        highway: "residential",
        oneway: "yes",
        // Notice: NO surface tag! Strictly unknown.
      },
      coordinates: [
        [9.2085, 45.4675],
        [9.2115, 45.4670],
        [9.2145, 45.4665],
      ],
    },
    // 13. UNTAGGED Residential Street: Via Archimede (NO surface tag -> Strictly UNKNOWN)
    {
      id: 20000013,
      name: "Via Archimede",
      tags: {
        highway: "residential",
        oneway: "yes",
        // Notice: NO surface tag! Strictly unknown.
      },
      coordinates: [
        [9.2085, 45.4665],
        [9.2120, 45.4660],
        [9.2155, 45.4655],
      ],
    },
    // 14. Compacted Park Path: Giardini Pubblici Indro Montanelli (Unpaved loose)
    {
      id: 20000014,
      name: "Viale delle Querce (Giardini Montanelli)",
      tags: {
        highway: "path",
        surface: "compacted",
        smoothness: "intermediate",
        bicycle: "yes",
        foot: "yes",
      },
      coordinates: [
        [9.2000, 45.4730],
        [9.2020, 45.4725],
        [9.2040, 45.4720],
      ],
    },
    // 15. Via Torino (Tertiary with tramway in sett, flanked by asphalt)
    {
      id: 20000015,
      name: "Via Torino",
      tags: {
        highway: "tertiary",
        surface: "sett",
        smoothness: "bad",
        railway: "tram",
        embedded_rails: "yes",
        oneway: "no",
      },
      coordinates: [
        [9.1870, 45.4625],
        [9.1850, 45.4595],
        [9.1830, 45.4570],
      ],
    },
  ];

  // Merge the raw pavé ways with the representative network
  const mergedMap = new Map();
  for (const way of rawPave) {
    mergedMap.set(way.id, way);
  }
  for (const way of representativeWays) {
    mergedMap.set(way.id, way);
  }

  const combined = [...mergedMap.values()];
  await writeFile(outputPath, JSON.stringify(combined, null, 2), "utf8");

  return {
    totalWays: combined.length,
    outputPath,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildRepresentativeNetwork()
    .then((res) => {
      console.log(`Representative road network built: ${res.outputPath}`);
      console.log(`- Total ways: ${res.totalWays}`);
    })
    .catch((err) => {
      console.error("Failed to build representative network:", err);
      process.exit(1);
    });
}
