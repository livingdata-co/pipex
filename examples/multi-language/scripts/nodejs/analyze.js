const {groupBy, mapValues, meanBy, size} = require('lodash')
const fs = require('fs')
const path = require('path')

// Sample dataset
const data = [
  {category: 'backend', language: 'Go', score: 92},
  {category: 'backend', language: 'Rust', score: 95},
  {category: 'backend', language: 'Java', score: 85},
  {category: 'frontend', language: 'TypeScript', score: 90},
  {category: 'frontend', language: 'JavaScript', score: 82},
  {category: 'data', language: 'Python', score: 94},
  {category: 'data', language: 'R', score: 78},
  {category: 'data', language: 'Julia', score: 80}
]

// Analyze using lodash
const grouped = groupBy(data, 'category')
const analysis = mapValues(grouped, items => ({
  count: size(items),
  avgScore: meanBy(items, 'score'),
  languages: items.map(i => i.language)
}))

const result = {
  generatedBy: 'node-analyze',
  timestamp: new Date().toISOString(),
  totalLanguages: data.length,
  analysis
}

const outputPath = path.join('/output', 'analysis.json')
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2))
console.log(`Analysis written to ${outputPath}`)
console.log(`Categories: ${Object.keys(analysis).join(', ')}`)
