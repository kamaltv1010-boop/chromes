"use strict";

/// Noor's WebGL Vendor & Renderer: the graphics card a profile shows sites
/// instead of this PC's, one of the cards PCs commonly have, as Chrome on
/// Windows names them. Chrome draws WebGL with ANGLE on Direct3D 11, so
/// WebGL tells "Google Inc. (NVIDIA)" and "ANGLE (NVIDIA, NVIDIA GeForce
/// RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)": the maker, the
/// card's name as Windows has it, and its device id. WebGPU tells the
/// maker and the card's family ("nvidia", "ampere"). Every card here draws
/// with Direct3D 11 as this PC's does, so WebGL's limits are a PC's either
/// way.

/// [maker, name as Windows has it, device id, family as WebGPU names it].
const GPUS = [
  ["NVIDIA", "NVIDIA GeForce GTX 1050 Ti", 0x1c82, "pascal"],
  ["NVIDIA", "NVIDIA GeForce GTX 1060 6GB", 0x1c03, "pascal"],
  ["NVIDIA", "NVIDIA GeForce GTX 1650", 0x1f82, "turing"],
  ["NVIDIA", "NVIDIA GeForce GTX 1660 SUPER", 0x21c4, "turing"],
  ["NVIDIA", "NVIDIA GeForce RTX 2060", 0x1f08, "turing"],
  ["NVIDIA", "NVIDIA GeForce RTX 3050", 0x2507, "ampere"],
  ["NVIDIA", "NVIDIA GeForce RTX 3060", 0x2504, "ampere"],
  ["NVIDIA", "NVIDIA GeForce RTX 3060 Laptop GPU", 0x2520, "ampere"],
  ["NVIDIA", "NVIDIA GeForce RTX 3060 Ti", 0x2489, "ampere"],
  ["NVIDIA", "NVIDIA GeForce RTX 3070", 0x2484, "ampere"],
  ["NVIDIA", "NVIDIA GeForce RTX 4060", 0x2882, "lovelace"],
  ["NVIDIA", "NVIDIA GeForce RTX 4060 Ti", 0x2803, "lovelace"],
  ["NVIDIA", "NVIDIA GeForce RTX 4070", 0x2786, "lovelace"],
  ["Intel", "Intel(R) HD Graphics 620", 0x5916, "gen-9"],
  ["Intel", "Intel(R) UHD Graphics 620", 0x5917, "gen-9"],
  ["Intel", "Intel(R) UHD Graphics 630", 0x3e92, "gen-9"],
  ["Intel", "Intel(R) Iris(R) Xe Graphics", 0x9a49, "gen-12lp"],
  ["Intel", "Intel(R) Iris(R) Xe Graphics", 0x46a6, "gen-12lp"],
  ["Intel", "Intel(R) UHD Graphics 730", 0x4692, "gen-12lp"],
  ["Intel", "Intel(R) UHD Graphics 770", 0x4680, "gen-12lp"],
  ["AMD", "Radeon RX 580 Series", 0x67df, "gcn-4"],
  ["AMD", "AMD Radeon(TM) Vega 8 Graphics", 0x15d8, "gcn-5"],
  ["AMD", "AMD Radeon(TM) Graphics", 0x1638, "gcn-5"],
  ["AMD", "AMD Radeon RX 6600", 0x73ff, "rdna-2"],
  ["AMD", "AMD Radeon RX 6700 XT", 0x73df, "rdna-2"],
  ["AMD", "AMD Radeon RX 7600", 0x7480, "rdna-3"],
].map(([maker, name, id, architecture]) => ({ maker, name, id, architecture }));

/// What sites are told of a card: WebGL's vendor and renderer, and
/// WebGPU's maker and family.
const graphicsOf = (gpu) => ({
  vendor: `Google Inc. (${gpu.maker})`,
  renderer: `ANGLE (${gpu.maker}, ${gpu.name} (0x${gpu.id.toString(16).toUpperCase().padStart(8, "0")}) Direct3D11 vs_5_0 ps_5_0, D3D11)`,
  webgpu: { vendor: gpu.maker.toLowerCase(), architecture: gpu.architecture },
});

module.exports = { GPUS, graphicsOf };
