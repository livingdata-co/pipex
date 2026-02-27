import test from 'ava'
import {isKitStep} from '../types.js'

test('isKitStep returns true when step has uses', t => {
  t.true(isKitStep({uses: 'node', name: 'build'}))
})

test('isKitStep returns false when step has no uses', t => {
  t.false(isKitStep({image: 'alpine', cmd: ['echo', 'hi'], name: 'build'}))
})
