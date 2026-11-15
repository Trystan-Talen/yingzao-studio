interface Edge {
  from: number;
  to: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  direction: number;
  visited: boolean;
}
export interface CalibratedBoundary {
  x: number;
  y: number;
  nx: number;
  ny: number;
  width: number;
  offset: number;
  confidence: number;
  hard: boolean;
  locked: boolean;
  measured: boolean;
  calibrate: boolean;
}
function sample(field: Float32Array, width: number, height: number, x: number, y: number) {
  x = Math.max(0, Math.min(width - 1, x));
  y = Math.max(0, Math.min(height - 1, y));
  const l = Math.floor(x),
    t = Math.floor(y),
    r = Math.min(l + 1, width - 1),
    b = Math.min(t + 1, height - 1);
  return (
    (field[t * width + l]! * (1 - x + l) + field[t * width + r]! * (x - l)) * (1 - y + t) +
    (field[b * width + l]! * (1 - x + l) + field[b * width + r]! * (x - l)) * (y - t)
  );
}

/** Follow each automatic contour separately; disconnected holes never share a softness estimate. */
export function sourceBoundaryProfiles(
  proposal: Float32Array,
  color: Float32Array[],
  width: number,
  height: number,
  radius: number,
  scale: number,
) {
  const edges: Edge[] = [];
  const starts = new Map<number, number[]>();
  const ends = new Set<number>();
  function edge(x: number, y: number, dx: number, dy: number, direction: number) {
    const from = y * (width + 1) + x,
      to = (y + dy) * (width + 1) + x + dx;
    const id = edges.length;
    edges.push({
      from,
      to,
      x: x + dx / 2 - 0.5,
      y: y + dy / 2 - 0.5,
      dx,
      dy,
      direction,
      visited: false,
    });
    starts.set(from, [...(starts.get(from) ?? []), id]);
    ends.add(to);
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (proposal[i]! >= 0.5) continue;
      if (y && proposal[i - width]! >= 0.5) edge(x, y, 1, 0, 0);
      if (x < width - 1 && proposal[i + 1]! >= 0.5) edge(x + 1, y, 0, 1, 1);
      if (y < height - 1 && proposal[i + width]! >= 0.5) edge(x + 1, y + 1, -1, 0, 2);
      if (x && proposal[i - 1]! >= 0.5) edge(x, y + 1, 0, -1, 3);
    }
  const paths: { ids: number[]; closed: boolean }[] = [];
  const order = edges
    .map((_, id) => id)
    .sort((a, b) => Number(ends.has(edges[a]!.from)) - Number(ends.has(edges[b]!.from)));
  for (const start of order) {
    if (edges[start]!.visited) continue;
    const ids: number[] = [];
    let current: number | undefined = start;
    while (current !== undefined && !edges[current]!.visited) {
      const e: Edge = edges[current]!;
      e.visited = true;
      ids.push(current);
      const choices: number[] = (starts.get(e.to) ?? []).filter((id) => !edges[id]!.visited);
      const rank = (id: number) => [1, 0, 3, 2][(edges[id]!.direction - e.direction + 4) % 4]!;
      choices.sort((a, b) => rank(a) - rank(b));
      current = choices[0];
    }
    paths.push({ ids, closed: edges[ids.at(-1)!]!.to === edges[start]!.from });
  }
  const profiles: CalibratedBoundary[] = edges.map((e) => ({
    x: e.x,
    y: e.y,
    nx: e.dy,
    ny: -e.dx,
    width: 0,
    offset: 0,
    confidence: 0,
    hard: false,
    locked: false,
    measured: false,
    calibrate: true,
  }));
  const values = new Float32Array(17);
  const at = (ids: number[], index: number, closed: boolean) =>
    closed ? ids[(index + ids.length) % ids.length] : ids[index];
  for (const { ids, closed } of paths)
    for (let j = 0; j < ids.length; j++) {
      const p = profiles[ids[j]!]!;
      let nx = 0,
        ny = 0;
      for (let k = -3; k <= 3; k++) {
        const id = at(ids, j + k, closed);
        if (id === undefined) continue;
        nx += edges[id]!.dy;
        ny -= edges[id]!.dx;
      }
      const magnitude = Math.hypot(nx, ny);
      if (!magnitude) continue;
      p.nx = nx /= magnitude;
      p.ny = ny /= magnitude;
      // A strong, narrow photographed edge is an opaque detail, not a feathering request.
      // Lock it independently of the longer profile, which may contain glass reflections.
      let sharpDifference = 0,
        totalDifference = 0;
      for (let offset = -3; offset <= 3; offset++) {
        let squared = 0;
        for (const field of color) {
          const difference =
            sample(field, width, height, p.x + nx * (offset + 0.5), p.y + ny * (offset + 0.5)) -
            sample(field, width, height, p.x + nx * (offset - 0.5), p.y + ny * (offset - 0.5));
          squared += difference * difference;
        }
        const difference = Math.sqrt(squared);
        sharpDifference = Math.max(sharpDifference, difference);
        totalDifference += difference;
      }
      if (sharpDifference > 25 / 255 && sharpDifference / totalDifference > 0.28) {
        p.hard = p.locked = true;
        p.confidence = 1;
        p.measured = true;
        continue;
      }
      const fx = p.x - nx * radius,
        fy = p.y - ny * radius,
        bx = p.x + nx * radius,
        by = p.y + ny * radius;
      if (
        sample(proposal, width, height, fx, fy) > 0.05 ||
        sample(proposal, width, height, bx, by) < 0.95
      )
        continue;
      const foreground = color.map((field) => sample(field, width, height, fx, fy));
      const delta = color.map((field, c) => sample(field, width, height, bx, by) - foreground[c]!);
      const length = delta.reduce((sum, value) => sum + value * value, 0);
      if (length < (18 / 255) ** 2) continue;
      let reversed = 0,
        residual = 0;
      for (let step = 0; step < values.length; step++) {
        const position = -radius + (2 * radius * step) / (values.length - 1);
        const rgb = color.map((field) =>
          sample(field, width, height, p.x + nx * position, p.y + ny * position),
        );
        const alpha =
          rgb.reduce((sum, value, c) => sum + (value - foreground[c]!) * delta[c]!, 0) / length;
        for (let c = 0; c < 3; c++)
          residual = Math.max(residual, Math.abs(rgb[c]! - foreground[c]! - alpha * delta[c]!));
        values[step] = Math.max(0, Math.min(1, alpha));
        if (step) reversed += Math.max(0, values[step - 1]! - values[step]!);
      }
      if (reversed > 0.12 || residual > 8 / 255) continue;
      for (let step = 1; step < values.length; step++)
        values[step] = Math.max(values[step]!, values[step - 1]!);
      const crossing = (threshold: number) => {
        for (let step = 1; step < values.length; step++)
          if (values[step]! >= threshold)
            return (
              -radius +
              (2 *
                radius *
                (step -
                  1 +
                  (threshold - values[step - 1]!) /
                    Math.max(0.00001, values[step]! - values[step - 1]!))) /
                (values.length - 1)
            );
        return radius;
      };
      const spread = crossing(0.9) - crossing(0.1),
        offset = crossing(0.5);
      if (spread > radius * 1.5 || Math.abs(offset) > radius / 2) continue;
      p.hard = spread * scale < 6;
      p.confidence = 1;
      p.measured = true;
      p.width = p.hard ? 0 : spread / 0.6084;
      p.offset = p.hard ? 0 : offset;
    }
  // Require source measurements for at least 90% of a connected contour before
  // applying its local feathering. This is a conservative eligibility rule, not a
  // calibrated probability of semantic correctness. Reject an unreliable contour
  // as a whole: per-pixel fallback creates alternating sharp/soft seams.
  let skippedContours = 0;
  for (const { ids } of paths) {
    const measured = ids.filter((id) => profiles[id]!.measured).length;
    if (measured / ids.length >= 0.9) continue;
    skippedContours++;
    for (const id of ids) profiles[id]!.calibrate = false;
  }
  const original = profiles.map((p) => ({ ...p }));
  const reach = Math.max(4, Math.round(radius * 2));
  for (const { ids, closed } of paths)
    for (let j = 0; j < ids.length; j++) {
      const p = profiles[ids[j]!]!;
      if (p.locked || !p.calibrate) continue;
      let total = 0,
        widthSum = 0,
        offsetSum = 0;
      for (const direction of [-1, 1])
        for (let k = 0; k <= Math.min(reach, ids.length - 1); k++) {
          if (direction === 1 && k === 0) continue;
          const id = at(ids, j + direction * k, closed);
          if (id === undefined) break;
          const candidate = original[id]!;
          const weight = candidate.confidence * Math.exp(-2 * (k / reach) ** 2);
          total += weight;
          widthSum += weight * candidate.width;
          offsetSum += weight * candidate.offset;
        }
      if (total > 0) {
        p.width = widthSum / total;
        p.offset = offsetSum / total;
        p.confidence = Math.min(1, total / Math.max(4, reach * 0.3));
      }
    }
  const nearest = new Int32Array(width * height).fill(-1),
    distance = new Uint16Array(width * height).fill(32767);
  for (let id = 0; id < profiles.length; id++) {
    const p = profiles[id]!;
    for (const side of [-0.5, 0.5]) {
      const x = Math.max(0, Math.min(width - 1, Math.round(p.x + p.nx * side))),
        y = Math.max(0, Math.min(height - 1, Math.round(p.y + p.ny * side))),
        i = y * width + x;
      nearest[i] = id;
      distance[i] = 0;
    }
  }
  const propagate = (to: number, from: number) => {
    if (distance[from]! + 1 < distance[to]!) {
      distance[to] = distance[from]! + 1;
      nearest[to] = nearest[from]!;
    }
  };
  for (let i = 0; i < nearest.length; i++) {
    if (i % width) propagate(i, i - 1);
    if (i >= width) propagate(i, i - width);
  }
  for (let i = nearest.length - 1; i >= 0; i--) {
    if (i % width < width - 1) propagate(i, i + 1);
    if (i < nearest.length - width) propagate(i, i + width);
  }
  return { profiles, nearest, skippedContours };
}
