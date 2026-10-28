// Tracks exact distance thresholds without relying on render time or RNG.
export class MilestoneTracker {
  constructor(intervalM = 1000) {
    this.intervalM = intervalM;
    this.reset();
  }

  reset() { this.nextDistanceM = this.intervalM; }

  crossed(distanceM) {
    const milestones = [];
    while (distanceM >= this.nextDistanceM) {
      milestones.push(this.nextDistanceM);
      this.nextDistanceM += this.intervalM;
    }
    return milestones;
  }
}

export default MilestoneTracker;
