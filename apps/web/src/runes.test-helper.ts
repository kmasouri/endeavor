import { readFileSync } from 'node:fs';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';

// Compile runes as Vite does, then resolve runtime imports for the in-memory module.
export async function loadRunes(file: URL, harness = '') {
  const javascript = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
  }).outputText;
  const code = compileModule(javascript + harness, {
    filename: file.pathname.replace('.ts', '.js'),
    generate: 'client'
  }).js.code.replace(
    /from (['"])(svelte[^'"]*)\1/g,
    (_, _quote, name: string) => `from ${JSON.stringify(import.meta.resolve(name))}`
  );
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
