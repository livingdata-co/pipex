const config = {
  files: [
    'src/**/__tests__/**/*.ts',
    '!src/**/__tests__/**/helpers.ts'
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
