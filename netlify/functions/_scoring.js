// _scoring.js (updated)
export function scoreProvisional(activity, payload) {
  switch (activity) {
    case "scavenger": {
      // If you submit one item per call, this will be 0 or 15 by presence only.
      // If you submit multiple items, give 10 per item as a crude proxy (<=15 is AI’s job later).
      const items = (payload?.items || []).filter(i => i?.photoUrl);
      if (items.length <= 1) return items.length ? 10 : 0; // rough proxy; AI will set 0/5/10/15
      return Math.min(60, items.length * 10); // cap so it doesn't dwarf other activities pre-AI
    }
    case "kindness": {
      const words = (payload?.description || "").trim().split(/\s+/).filter(Boolean).length;
      const media = (payload?.photoUrl || payload?.videoUrl) ? 5 : 0;
      // Heuristic: ~1 point per ~15 words + media bonus, clamped to 60
      return Math.min(60, Math.floor(words / 15) + media);
    }
    case "limerick": {
      const text = payload?.text || "";
      const lines = text.split(/\n/).length;
      const syll = text.split(/[aeiouy]+/i).length;
      let base = Math.min(60, Math.floor(syll / 7) + (lines >= 5 ? 8 : 0));
      if (/^The teams set off on their Quest/i.test(text)) base += 2;
      return Math.min(60, base);
    }
    default:
      return 0;
  }
}
