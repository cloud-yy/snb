export default function (percent, width, mode = "floor") {
    if (!Number.isFinite(percent)) percent = 0;

    const p = Math.max(0, Math.min(100, percent <= 1 ? percent * 100 : percent))
    const rounder = mode === "round" ? Math.round : mode === "ceil" ? Math.ceil : Math.floor
    const filled = rounder((p / 100) * width)
    
    return "█".repeat(filled) + "░".repeat(width - filled)
}