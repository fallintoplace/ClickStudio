import { runAssistantBenchmarks } from '../src/backend/assistant/evaluation/evaluation.js';

const report = runAssistantBenchmarks();
for (const result of report.results)
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.id} ${result.score}/100`);
console.log(
    `Assistant benchmark score: ${report.score}/100 (${report.passed}/${report.total} cases)`,
);
process.exitCode = report.passed === report.total ? 0 : 1;
