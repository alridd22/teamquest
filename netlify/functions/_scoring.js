export function scoreProvisional(activity, payload) {
  switch (activity) {
    case "scavenger":
      return Math.min(100, (payload?.items || []).filter(i => i?.photoUrl).length * 10);
    case "kindness": {
      const words = (payload?.description || "").trim().split(/\s+/).filter(Boolean).length;
      const media = (payload?.photoUrl || payload?.videoUrl) ? 5 : 0;
      return Math.min(30, Math.floor(words / 20) + media);
    }
    case "limerick": {
      const text = payload?.text || "";
      const lines = text.split(/\n/).length;
      const syll = text.split(/[aeiouy]+/i).length;
      let base = Math.min(30, Math.floor(syll / 12) + (lines >= 5 ? 5 : 0));
      if (/^The teams set off on their Quest/i.test(text)) base += 5;
      return Math.min(40, base);
    }
    default:
      return 0;
  }
}
