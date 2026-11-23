// Forward hover to the PRISM timeline so the player supplies and renders its own thumbnail.
function kirinukiNativePreview(player, tooltip, getRail, getDuration, scoreAt) {
  let input = null, frame = null;
  let activeRail = null, hoveredThumb = null, trackBox = null, positioned = null;
  let timeLabel = null, description = null;

  function releaseThumb() {
    if (!hoveredThumb) return;
    activeRail?.removeAttribute("data-kirinuki-preview-hover");
    if (!hoveredThumb.matches(":hover"))
      hoveredThumb.dispatchEvent(new MouseEvent("mouseleave"));
    hoveredThumb = null;
  }
  function restorePosition() {
    if (!positioned) return;
    if (positioned.matches(":popover-open")) positioned.hidePopover();
    positioned.removeAttribute("popover");
    positioned.removeAttribute("data-kirinuki-preview");
    for (const property of ["x", "y", "image-width", "image-height"])
      positioned.style.removeProperty("--kirinuki-preview-" + property);
    timeLabel?.removeAttribute("data-kirinuki-score");
    description?.removeAttribute("data-kirinuki-selection");
    timeLabel = description = null;
    tooltip.removeAttribute("data-native-preview");
    positioned = null;
  }
  function hide(surface) {
    if (surface && input?.surface !== surface) return;
    input = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    restorePosition();
    releaseThumb();
    if (activeRail && !activeRail.matches(":hover"))
      activeRail.dispatchEvent(new MouseEvent("mouseleave"));
    activeRail = trackBox = null;
  }

  function leave(surface) {
    if (input?.surface !== surface) return;
    // Crossing from the rail to its graph can replace the request in the same frame.
    input = null;
    if (frame === null) frame = requestAnimationFrame(update);
  }

  function position(preview, { anchor, clientX }, point) {
    if (positioned !== preview) {
      restorePosition();
      if (!preview.offsetWidth) return;
      preview.setAttribute("popover", "manual");
      preview.setAttribute("data-kirinuki-preview", "");
      preview.showPopover();
      positioned = preview;
    }
    if (!preview.offsetWidth) {
      restorePosition();
      return;
    }
    const label = preview.querySelector(".pzp-seeking-preview__time");
    if (label !== timeLabel) timeLabel?.removeAttribute("data-kirinuki-score");
    timeLabel = label;
    const text = preview.querySelector(".pzp-seeking-preview__description");
    if (text !== description) description?.removeAttribute("data-kirinuki-selection");
    description = text;
    const nativeSeconds = label?.textContent.trim().split(":")
      .reduce((sum, part) => sum * 60 + Number(part), 0);
    const score = point ? point.score : scoreAt(nativeSeconds);
    if (Number.isFinite(score)) label?.setAttribute("data-kirinuki-score", score.toFixed(3));
    else label?.removeAttribute("data-kirinuki-score");
    if (point?.selection) text?.setAttribute("data-kirinuki-selection", point.selection);
    else text?.removeAttribute("data-kirinuki-selection");
    tooltip.toggleAttribute("data-native-preview", Boolean(text && point?.selection));

    const area = anchor.getBoundingClientRect(), outer = player.getBoundingClientRect();
    const gap = 8;
    const image = preview.querySelector(".pzp-seeking-preview__sprite");
    const captionHeight = preview.offsetHeight - (image?.offsetHeight ?? 0);
    const up = area.top - 2 * gap, down = innerHeight - area.bottom - 2 * gap;
    const above = up >= captionHeight + (image?.offsetWidth ? 28 : 0);
    if (image) {
      const ratio = parseFloat(image.style.width) / parseFloat(image.style.height) || 16 / 9;
      const available = Math.max(0, (above ? up : down) - captionHeight);
      preview.style.setProperty("--kirinuki-preview-image-width", Math.min(available * ratio, innerWidth - 2 * gap) + "px");
      preview.style.setProperty("--kirinuki-preview-image-height", available + "px");
    }
    const width = preview.offsetWidth, height = preview.offsetHeight;
    const left = Math.max(gap, outer.left + gap), right = Math.min(innerWidth, outer.right) - gap;
    const x = Math.max(left, Math.min(clientX - width / 2, right - width));
    const y = above ? area.top - gap - height : area.bottom + gap;
    preview.style.setProperty("--kirinuki-preview-x", Math.min(x, Math.max(gap, innerWidth - gap - width)) + "px");
    preview.style.setProperty("--kirinuki-preview-y", Math.max(gap, Math.min(y, innerHeight - gap - height)) + "px");
  }

  function update() {
    frame = null;
    const request = input;
    if (!request) return hide();
    const rail = getRail();
    const preview = player.querySelector(".pzp-pc__seeking-preview");
    const duration = getDuration();
    if (!request.surface.isConnected || !rail?.matches(".pzp-pc__progress-slider") ||
        !preview || !duration || activeRail && activeRail !== rail) {
      hide();
      return;
    }
    activeRail = rail;
    if (!request.expandRail) releaseThumb();
    if (request.surface === rail) {
      // The physical rail already moved its preview, including during native seeks.
      position(preview, request, null);
      return;
    }
    const point = request.pointAt(request.clientX, request.target);
    const track = rail.querySelector(".pzp-ui-progress__entire-background") ?? rail;
    const bounds = track.getBoundingClientRect();
    if (!Number.isFinite(point?.seconds) || !bounds.width) {
      hide();
      return;
    }
    const init = {
      bubbles: true, view: window, pointerType: "mouse",
      clientX: bounds.left + Math.max(0, Math.min(point.seconds / duration, 1)) * bounds.width,
      clientY: bounds.top + bounds.height / 2,
    };
    if (request.expandRail && !hoveredThumb) {
      hoveredThumb = rail.querySelector(".pzp-ui-slider__handler-wrap");
      if (hoveredThumb) {
        rail.setAttribute("data-kirinuki-preview-hover", "");
        hoveredThumb.dispatchEvent(new MouseEvent("mouseover", init));
      }
    }
    if (!trackBox || trackBox.left !== bounds.left || trackBox.width !== bounds.width) {
      // The player's mouseover handler measures the track before interpreting mousemove.
      rail.dispatchEvent(new MouseEvent("mouseover", init));
      trackBox = bounds;
    }
    // PointerEvent retains subpixel X when delivered to the player's mousemove listener.
    rail.dispatchEvent(new PointerEvent("mousemove", init));
    queueMicrotask(() => {
      if (input === request) position(preview, request, point);
    });
  }

  function refresh() {
    if (input && frame === null) frame = requestAnimationFrame(update);
  }
  function hover(event, pointAt, { anchor = event.currentTarget, expandRail = false } = {}) {
    const surface = event.currentTarget;
    if (event.pointerType !== "mouse" || (event.buttons && !(event.buttons & 1))) return leave(surface);
    input = { surface, anchor, target: event.target, clientX: event.clientX, pointAt, expandRail };
    refresh();
  }
  return { hover, leave, hide, refresh };
}
