/**
 * The unified anchor space.
 *
 * Every pointable thing on the Stage has a stable snake_case id. The tutor names
 * ids ("left_ventricle"); nothing upstream ever deals in coordinates or in
 * Terminologia Anatomica Latin.
 */

export interface AnchorEntry {
  /** Stable id, and the glTF node name it resolves to. */
  node: string;
  /** Original object name in the source .blend, for the asset pipeline. */
  source: string;
  /** Terminologia Anatomica name, for reference. */
  ta: string;
  /** What a student should see on screen. */
  label: string;
}

export class AnchorRegistry {
  private readonly byId: Map<string, AnchorEntry>;

  private constructor(entries: AnchorEntry[]) {
    this.byId = new Map();
    for (const e of entries) {
      if (this.byId.has(e.node)) throw new Error(`duplicate anchor node id: ${e.node}`);
      this.byId.set(e.node, e);
    }
  }

  static fromJson(json: unknown): AnchorRegistry {
    const doc = json as { anchors?: unknown };
    if (!Array.isArray(doc?.anchors)) {
      throw new Error('malformed anchor document: expected an "anchors" array');
    }
    return new AnchorRegistry(doc.anchors as AnchorEntry[]);
  }

  ids(): ReadonlySet<string> {
    return new Set(this.byId.keys());
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  label(id: string): string {
    const entry = this.byId.get(id);
    if (!entry) throw new Error(`unknown anchor: ${id}`);
    return entry.label;
  }

  /** Declaration order is preserved — the UI lists anchors in author order. */
  all(): readonly AnchorEntry[] {
    return [...this.byId.values()];
  }
}
