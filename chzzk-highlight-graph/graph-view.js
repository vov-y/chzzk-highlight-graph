const kirinukiGraphView = (frameTime, time) => {
  const peakLift = 16; // Extra CSS pixels available above the original graph.
  const sampleInputs = new WeakMap();

  function highlightMask(peaks, length, percent) {
    if (!percent || !peaks.length) return null;
    // A flat graph has no visible peak, even when it yields one recommendation.
    if (peaks.length === 1 && peaks[0].start === 0 && peaks[0].end === length - 1) return null;
    const mask = new Uint8Array(length);
    const count = Math.ceil(peaks.length * percent / 100);
    for (let i = 0; i < count; i++) {
      const { start, end } = peaks[i];
      mask.fill(1, start, end + 1);
    }
    return mask;
  }

  function scoreHeight(score, peak, plotHeight) {
    return score * (plotHeight + (peak ? peakLift : 0));
  }

  function edgePoint(result, peakMask, seconds, x, plotHeight) {
    const index = Math.max(0, Math.min(result.scores.length - 1,
      (seconds - frameTime(0, result)) / result.step));
    const low = Math.floor(index), high = Math.ceil(index);
    const left = scoreHeight(result.scores[low], peakMask?.[low], plotHeight);
    const right = scoreHeight(result.scores[high], peakMask?.[high], plotHeight);
    return { x, height: left + (right - left) * (index - low) };
  }

  // Reduce by pixel without moving the retained point off its playback time.
  function samples(result, peakMask, width, start, end, plotHeight) {
    if (end <= start) return [];
    const points = [];
    const first = frameTime(0, result);
    const lo = Math.max(0, Math.ceil((start - first) / result.step));
    const hi = Math.min(result.scores.length - 1, Math.floor((end - first) / result.step));
    for (let i = lo; i <= hi; i++) {
      const seconds = frameTime(i, result);
      const x = ((seconds - start) / (end - start)) * width;
      const pixel = Math.min(width - 1, Math.floor(x));
      const score = result.scores[i];
      const height = scoreHeight(score, peakMask?.[i], plotHeight);
      const previous = points.at(-1);
      if (previous?.pixel !== pixel) {
        points.push({ x, pixel, seconds, score, height });
      } else if (height > previous.height) {
        points[points.length - 1] = { x, pixel, seconds, score, height };
      }
    }
    return points;
  }
  function draw(canvas, start, end, result, peakMask, video, { rasterWidth, sampleWidth } = {}) {
    const previous = sampleInputs.get(canvas);
    const rect = canvas.getBoundingClientRect(),
      w = Math.max(1, Math.round(rasterWidth ?? rect.width)),
      plotWidth = Math.max(1, Math.round(sampleWidth ?? rect.width)),
      h = Math.max(1, Math.round(rect.height)),
      dpr = devicePixelRatio || 1;
    const pixelsWide = Math.round(w * dpr), pixelsHigh = Math.round(h * dpr);
    if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
    if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (
      !previous || previous.scores !== result.scores || previous.peakMask !== peakMask ||
      previous.step !== result.step || previous.window !== result.window ||
      previous.height !== h || canvas._plotWidth !== plotWidth ||
      canvas._domain[0] !== start || canvas._domain[1] !== end
    ) {
      const plotHeight = h - 6 - (peakMask ? peakLift : 0);
      canvas._points = samples(result, peakMask, plotWidth, start, end, plotHeight);
      canvas._plotWidth = plotWidth;
      canvas._domain = [start, end];
      let curve = canvas._points;
      if (canvas.id === "detail" && result.scores.length && (start > 0 || end < result.duration)) {
        // Interpolate the cropped edges without adding seek targets.
        curve = [...curve];
        if (curve[0]?.x !== 0) curve.unshift(edgePoint(result, peakMask, start, 0, plotHeight));
        if (curve.at(-1)?.x !== plotWidth) curve.push(edgePoint(result, peakMask, end, plotWidth, plotHeight));
      }
      sampleInputs.set(canvas, {
        scores: result.scores, peakMask, step: result.step, window: result.window, height: h, curve,
      });
    }
    const points = sampleInputs.get(canvas).curve;
    if (!points.length) return;
    const baseline = h - 3;
    if (plotWidth !== w) ctx.scale(w / plotWidth, 1);
    ctx.beginPath();
    ctx.moveTo(points[0].x, baseline - points[0].height);
    const slopeBetween = (a, b) => (b.height - a.height) / (b.x - a.x);
    let slope = points.length > 1 ? slopeBetween(points[0], points[1]) : 0;
    let startSlope = slope;
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1], point = points[i], next = points[i + 1];
      const followingSlope = next ? slopeBetween(point, next) : slope;
      // Flatten peaks and valleys and limit each tangent to the adjacent slopes.
      const endSlope = slope * followingSlope > 0
        ? Math.sign(slope) * Math.min(Math.abs(slope), Math.abs(followingSlope)) : 0;
      const dx = (point.x - previous.x) / 3, y = baseline - point.height;
      ctx.bezierCurveTo(previous.x + dx, baseline - previous.height - startSlope * dx,
        point.x - dx, y + endSlope * dx, point.x, y);
      startSlope = endSlope;
      slope = followingSlope;
    }
    const overview = canvas.id === "overview";
    ctx.strokeStyle = overview ? "rgb(255 255 255 / .68)" : "rgb(255 255 255 / .82)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.lineTo(points.at(-1).x, h);
    ctx.lineTo(points[0].x, h);
    ctx.closePath();
    ctx.fillStyle = overview ? "rgb(255 255 255 / .34)" : "rgb(255 255 255 / .22)";
    ctx.fill();
    if (video) {
      const x = ((video.currentTime - start) / (end - start)) * plotWidth;
      if (x >= 0 && x <= plotWidth) {
        ctx.strokeStyle = "rgb(255 255 255 / .88)";
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }
    canvas.setAttribute("aria-valuemax", Math.floor(result.duration));
    canvas.setAttribute("aria-valuenow", Math.floor(video?.currentTime || 0));
    canvas.setAttribute("aria-valuetext", time(video?.currentTime || 0));
  }

  function fractionAt(element, clientX) {
    const rect = element.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / (rect.width || 1)));
  }

  function pointAt(canvas, clientX, result) {
    if (!result || !canvas._domain) return null;
    const fraction = fractionAt(canvas, clientX);
    const [start, end] = canvas._domain;
    const width = canvas._plotWidth, x = fraction * width;
    const points = canvas._points, pixel = Math.min(width - 1, Math.floor(x));
    let low = 0, high = points.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (points[mid].pixel < pixel) low = mid + 1;
      else high = mid;
    }
    const right = points[low];
    if (right?.pixel === pixel) return right;
    const seconds = start + fraction * (end - start);
    if (!points.length || seconds < frameTime(0, result) || seconds > frameTime(result.scores.length - 1, result)) {
      return { seconds };
    }
    const left = points[low - 1];
    if (!left) return right;
    if (!right) return left;
    return Math.abs(right.x - x) < Math.abs(left.x - x) ? right : left;
  }

  return { draw, fractionAt, pointAt, highlightMask, peakLift };
};
