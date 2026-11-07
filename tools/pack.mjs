/* ==================================================================
 * 零依赖 ZIP 打包器（Node 内置 zlib，不需要 7z / zip 命令）
 *
 *   node tools/pack.mjs <源目录> <输出.zip> [--exclude=dir1,dir2]
 *
 * 为什么要自己写：Windows 的 Compress-Archive 会把 ZIP 内的路径写成
 * 反斜杠（assets\index.js）。在 Windows 上解开没问题，但 GitHub Pages
 * 的「上传 ZIP 自动解压」和一些 Linux 工具会当成一个超长文件名，
 * 结果整站 404。这里统一写正斜杠，并按规范设置 UTF-8 标志位。
 * ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function walk(dir, base, skip, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = path.join(base, e.name).split(path.sep).join('/');
    if (skip.some((s) => rel === s || rel.startsWith(s + '/'))) continue;
    if (e.isDirectory()) walk(abs, rel, skip, out);
    else if (e.isFile()) out.push({ abs, rel });
  }
  return out;
}

/** 固定时间戳：同一份源码多次打包，字节完全一致，便于核对。 */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function makeZip(srcDir, outFile, { exclude = [] } = {}) {
  const files = walk(srcDir, '', exclude, []).sort((a, b) => (a.rel < b.rel ? -1 : 1));
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const raw = fs.readFileSync(f.abs);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const name = Buffer.from(f.rel, 'utf8');
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);                 // version needed
    local.writeUInt16LE(0x0800, 6);             // UTF-8 filename flag
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); // method
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);               // version made by
    central.writeUInt16LE(20, 6);               // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);               // extra
    central.writeUInt16LE(0, 32);               // comment
    central.writeUInt16LE(0, 34);               // disk
    central.writeUInt16LE(0, 36);               // internal attrs
    central.writeUInt32LE(0, 38);               // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(outFile, Buffer.concat([...locals, centralBuf, end]));
  const size = fs.statSync(outFile).size;
  return { files: files.length, size };
}

/* 直接当脚本用时：node tools/pack.mjs <src> <out.zip> [--exclude=a,b] */
const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const [src, out] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const ex = (process.argv.find((a) => a.startsWith('--exclude=')) || '').split('=')[1];
  if (!src || !out) {
    console.error('用法: node tools/pack.mjs <源目录> <输出.zip> [--exclude=dist,node_modules]');
    process.exit(2);
  }
  const r = makeZip(src, out, { exclude: ex ? ex.split(',') : [] });
  console.log(`${out}  ${r.files} 个文件  ${(r.size / 1048576).toFixed(2)} MB`);
}
