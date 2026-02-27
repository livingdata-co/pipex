const config = {
  files: [
    'src/**/__tests__/**/*.ts'
  ],
  typescript: {
    extensions: ['ts'],
    rewritePaths: {
      'src/': 'dist/'
    },
    compile: 'tsc'
  }
}

export default config
