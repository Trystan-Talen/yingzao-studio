import fs from 'node:fs';
import path from 'node:path';
import ts from '../platform/node_modules/typescript/lib/typescript.js';
const root=path.resolve(import.meta.dirname,'../platform');
const dict=ts.createSourceFile('i18n.ts',fs.readFileSync(path.join(root,'src/web/lib/i18n.ts'),'utf8'),ts.ScriptTarget.Latest,true);
const entries=new Set();
function keys(n){if(ts.isVariableDeclaration(n)&&n.name.getText(dict)==='TRANSLATIONS'&&n.initializer&&ts.isObjectLiteralExpression(n.initializer)) for(const p of n.initializer.properties) if(ts.isPropertyAssignment(p))entries.add(ts.isIdentifier(p.name)||ts.isStringLiteral(p.name)?p.name.text:'');ts.forEachChild(n,keys);}keys(dict);
const found=new Map();
function scan(file){const doc=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);function visit(n){if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isJsxText(n)){const raw=n.text.replace(/\s+/g,' ').trim();if(/[\u4e00-\u9fff]/.test(raw)){const list=found.get(raw)||[];list.push(path.relative(root,file));found.set(raw,list);}}ts.forEachChild(n,visit);}visit(doc);}
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(/\.(ts|tsx)$/.test(file)&&!/(i18n|\.test)\./.test(file))scan(file);}}walk(path.join(root,'src/web'));scan(path.join(root,'src/contracts/catalog.ts'));
const missing=[...found].filter(([key])=>!entries.has(key)).map(([text,files])=>({text,files:[...new Set(files)]}));
const result={checkedAt:new Date().toISOString(),translationEntries:entries.size,staticChinesePhrases:found.size,missing,scope:'src/web (excluding tests and dictionary) + src/contracts/catalog.ts; dynamic template interpolations and backend messages are outside static coverage count'};
fs.writeFileSync(path.join(import.meta.dirname,'i18n-static-coverage.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
