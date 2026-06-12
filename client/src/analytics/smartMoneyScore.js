// Composite 0–100 "Smart Money Score" from the three analysis modules.

export function smartMoneyScore({ flow, volume, exec }) {
  const components = [
    {
      key: 'insider',
      label: 'Insider flow',
      weight: 0.4,
      score: flow.score,
      rationale: flow.rationale,
    },
    {
      key: 'volume',
      label: 'Volume anomalies',
      weight: 0.3,
      score: volume.score,
      rationale: volume.rationale,
    },
    {
      key: 'exec',
      label: 'Execution patterns',
      weight: 0.3,
      score: exec.score,
      rationale: exec.rationale,
    },
  ];

  const score = Math.round(components.reduce((s, c) => s + c.score * c.weight, 0));

  let verdict, tone;
  if (score >= 72) [verdict, tone] = ['Strong accumulation footprint', 'bull'];
  else if (score >= 58) [verdict, tone] = ['Accumulation footprint', 'bull'];
  else if (score > 42) [verdict, tone] = ['Mixed / neutral tape', 'neutral'];
  else if (score > 28) [verdict, tone] = ['Distribution footprint', 'bear'];
  else [verdict, tone] = ['Strong distribution footprint', 'bear'];

  return { score, verdict, tone, components };
}
