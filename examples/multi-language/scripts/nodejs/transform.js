const fs = require('fs')
const path = require('path')
const {sortBy, flatMap} = require('lodash')

// Read input from previous step
const inputPath = path.join('/input/node-analyze', 'analysis.json')
const analysis = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
console.log(`Read analysis from ${inputPath}`)

// Transform: create a ranked report
const allLanguages = flatMap(
  Object.entries(analysis.analysis),
  ([category, data]) => data.languages.map((lang, i) => ({
    language: lang,
    category,
    rank: i + 1
  }))
)

const ranked = sortBy(allLanguages, 'language')

const report = {
  generatedBy: 'node-transform',
  timestamp: new Date().toISOString(),
  sourceStep: 'node-analyze',
  totalLanguages: analysis.totalLanguages,
  ranked,
  summary: Object.fromEntries(
    Object.entries(analysis.analysis).map(([cat, data]) => [
      cat,
      {count: data.count, avgScore: data.avgScore}
    ])
  )
}

const outputPath = path.join('/output', 'report.json')
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2))
console.log(`Report written to ${outputPath}`)
console.log(`Total languages ranked: ${ranked.length}`)
