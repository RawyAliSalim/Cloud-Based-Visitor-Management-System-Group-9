// Builds the Lambda --environment JSON for one function from:
//   argv[2]: JSON file with shared variables, argv[3]: file with extra KEY=VALUE lines (may be missing).
const fs = require('fs');

const variables = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const extraFile = process.argv[3];
if (extraFile && fs.existsSync(extraFile)) {
  for (const line of fs.readFileSync(extraFile, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) {
      variables[match[1]] = match[2];
    }
  }
}
for (const [key, value] of Object.entries(variables)) {
  if (value === '' || value === null || value === undefined) {
    delete variables[key];
  }
}
process.stdout.write(JSON.stringify({ Variables: variables }));
