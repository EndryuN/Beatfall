export class InputMapper {
  constructor(public codes: string[]) {}
  laneFor(code: string): number | null {
    const i = this.codes.indexOf(code);
    return i === -1 ? null : i;
  }
  rebind(lane: number, code: string): void {
    const old = this.codes.indexOf(code);
    if (old !== -1) this.codes[old] = this.codes[lane];   // swap to keep 4 unique codes
    this.codes[lane] = code;
  }
}
