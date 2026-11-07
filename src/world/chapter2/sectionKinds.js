/* ==================================================================
 * 分段 → 采样下标的映射（游戏与审计共用）
 *
 * 为什么需要这个模块：
 *   1. Catmull-Rom 是**参数曲线**，控制点并不落在等弧长参数 u=i/N 上。
 *      cp0→cp1 有 70 m，cp12→cp13 只有 24 m。按序号平均分会把九段长度
 *      算错 20~150 m，预览面板和实际几何就对不上。
 *   2. 路面类型不能插值。渔村段 cp12..cp16 是 1,1,4,4,4，标量曲线过冲后
 *      在 749 m 处算出 2.5，四舍五入变成 3（木桥）——「48 m 的桥」会在
 *      游戏里多出 60 个木板采样点。所以 kind 必须由分段**显式赋值**。
 *
 * 这里的规则只有一条：控制点 c 落在弧长 cum[c] 处，用弧长比例把
 * 控制点区间翻译成采样下标区间，再整段赋 kind。
 * ================================================================== */

/**
 * 控制点的弧长位置 → 每个采样点属于哪一段。
 *
 * @param {number} n          采样点数
 * @param {number} arcTotal   整圈弧长（米）
 * @param {Float64Array} cum  每个控制点的累计弧长（长度 = 控制点数 + 1）
 * @param {Array} sections    分段定义，from/to 是控制点下标
 * @returns {{ ranges: Array, indexAt: (ci:number)=>number }}
 */
export function sectionRanges(n, arcTotal, cum, sections) {
  const cn = cum.length - 1;
  const controlU = Array.from(cum, (d) => d / arcTotal);
  const indexAt = (ci) => Math.round(controlU[Math.min(ci, cn)] * n) % n;

  const ranges = sections.map((s) => {
    const d0 = cum[s.from];
    const d1 = s.to >= cn ? arcTotal : cum[s.to];
    return {
      ...s,
      d0,
      d1,
      i0: indexAt(s.from),
      i1: s.to >= cn ? 0 : indexAt(s.to),
      len: d1 - d0,
    };
  });
  return { ranges, indexAt, controlU };
}

/**
 * 把每个采样点的路面类型按分段显式写死。
 *
 * @param {number} n
 * @param {Array} ranges      sectionRanges() 的输出
 * @param {(si:number)=>any}  getKind  可选：覆盖 kind 取值的来源
 * @returns {{ kind: Uint8Array, owner: Int8Array, rangeOf: (i:number)=>object|null }}
 *   owner[i] = 采样点 i 属于第几段（-1 表示没有段覆盖，属于数据错误）
 */
export function assignSectionKinds(n, ranges) {
  const kind = new Uint8Array(n);
  const owner = new Int8Array(n).fill(-1);

  for (let si = 0; si < ranges.length; si++) {
    const r = ranges[si];
    const count = r.i1 >= r.i0
      ? r.i1 - r.i0
      : (n - r.i0) + r.i1;           // 跨 0 点的最后一段
    for (let k = 0; k < count; k++) {
      const i = (r.i0 + k + n) % n;
      kind[i] = r.kind;
      owner[i] = si;
    }
  }

  const rangeOf = (i) => {
    const j = ((i % n) + n) % n;
    const si = owner[j];
    return si >= 0 ? ranges[si] : null;
  };
  return { kind, owner, rangeOf };
}

/** 采样下标 → 弧长（米） */
export function sampleDistance(i, n, arcTotal) {
  return (((i % n) + n) % n) * (arcTotal / n);
}
