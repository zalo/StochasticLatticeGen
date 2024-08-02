import typescript from "@rollup/plugin-typescript";
import copy from "rollup-plugin-copy";

export default [
  {
    input: `src/index.ts`,
    plugins: [
      typescript(),
      copy({
        targets: [{ src: "src/voro_raw.wasm", dest: "dist" }],
      }),
    ],
    external: ["module"],
    output: [
      {
        dir: "dist",
        format: "es",
        sourcemap: true,
      },
    ],
  },
];
