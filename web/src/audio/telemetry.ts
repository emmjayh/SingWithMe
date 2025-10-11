export interface TelemetryEntry {
  timestamp: number;
  vad: number;
  pitch: number;
  confidence: number;
  gainDb: number;
}

export class TelemetryLog {
  private entries: TelemetryEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 2048) {
    this.maxEntries = maxEntries;
  }

  record(entry: TelemetryEntry) {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  export(): Blob {
    const blob = new Blob([JSON.stringify(this.entries, null, 2)], {
      type: "application/json"
    });
    return blob;
  }

  download(filename = "singwithme-telemetry.json") {
    const blob = this.export();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  reset() {
    this.entries = [];
  }
}
