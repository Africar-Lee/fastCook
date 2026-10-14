import assert from 'node:assert/strict';
import test from 'node:test';
import qrcode from 'qrcode-generator';
import { createRecipeQrMatrix, RECIPE_QR_MARGIN } from './recipe-qr.ts';
import { MAX_RECIPE_QR_BYTES } from './recipe-transfer.ts';

test('QR contains a four-module clear margin on every side', () => {
  const { data: matrix, error } = createRecipeQrMatrix('fastcook:recipe:1:test');
  assert.equal(error, null);
  assert.equal(RECIPE_QR_MARGIN, 4);
  assert.ok(matrix.length >= 29);
  for (let row = 0; row < matrix.length; row += 1) {
    assert.equal(matrix[row].length, matrix.length);
    for (let column = 0; column < matrix.length; column += 1) {
      assert.equal(typeof matrix[row][column], 'boolean');
      if (row < 4 || column < 4 || row >= matrix.length - 4 || column >= matrix.length - 4) {
        assert.equal(matrix[row][column], false);
      }
    }
  }
  assert.equal(matrix[4][4], true);
  assert.equal(matrix[4][matrix.length - 5], true);
  assert.equal(matrix[matrix.length - 5][4], true);
});

test('QR encodes Chinese and surrogate pairs using their exact UTF-8 bytes', () => {
  const { data: matrix, error } = createRecipeQrMatrix('番茄\u{20bb7}');
  assert.equal(error, null);
  const previousEncoder = qrcode.stringToBytes;
  qrcode.stringToBytes = () => [0xe7, 0x95, 0xaa, 0xe8, 0x8c, 0x84, 0xf0, 0xa0, 0xae, 0xb7];
  const expected = qrcode(0, 'M');
  expected.addData('known UTF-8 bytes', 'Byte');
  expected.make();
  qrcode.stringToBytes = previousEncoder;
  assert.equal(matrix.length, expected.getModuleCount() + 8);
  for (let row = 0; row < expected.getModuleCount(); row += 1) {
    for (let column = 0; column < expected.getModuleCount(); column += 1) {
      assert.equal(matrix[row + 4][column + 4], expected.isDark(row, column));
    }
  }
});

test('QR accepts the maximum UTF-8 payload and rejects oversized multibyte data', () => {
  assert.equal(createRecipeQrMatrix('a'.repeat(MAX_RECIPE_QR_BYTES)).error, null);
  assert.equal(createRecipeQrMatrix('番'.repeat(MAX_RECIPE_QR_BYTES / 3)).error, null);
  assert.ok(createRecipeQrMatrix('a'.repeat(MAX_RECIPE_QR_BYTES + 1)).error);
  assert.ok(createRecipeQrMatrix('番'.repeat(MAX_RECIPE_QR_BYTES / 3 + 1)).error);
});

test('QR rejects missing and non-string payloads without producing a matrix', () => {
  for (const input of ['', null, undefined, 42, {}, ['recipe']]) {
    const result = createRecipeQrMatrix(input);
    assert.equal(result.data, null);
    assert.ok(result.error);
  }
});

test('QR treats markup as data and produces only matrix booleans', () => {
  const first = createRecipeQrMatrix('<svg onload="unexpected()">菜谱</svg>');
  const second = createRecipeQrMatrix('<svg onload="unexpected()">菜谱</svg>');
  assert.equal(first.error, null);
  assert.deepEqual(first, second);
  assert.ok(first.data.flat().every(value => typeof value === 'boolean'));
});
