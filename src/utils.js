export const STORAGE = {
  students: 'passgate.students.v1',
  attendance: 'passgate.attendance.v1',
  settings: 'passgate.settings.v1',
  accounts: 'passgate.accounts.v1',
};

export const DEFAULT_CLASSES = [
  { name: 'Computer Basics', time: '09:00 – 11:00', days: 'Mon – Fri', color: 'c1' },
  { name: 'Graphic Design', time: '11:30 – 13:30', days: 'Mon – Wed', color: 'c2' },
  { name: 'Web Development', time: '14:00 – 16:00', days: 'Tue – Thu', color: 'c3' },
];

export function readStore(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'S';
}

export function fullName(student) {
  return [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ');
}

export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dateLabel(iso) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function generateId(students) {
  const year = String(new Date().getFullYear()).slice(-2);
  const sequence = students.reduce((max, student) => {
    const match = student.id.match(/-(\d{6})$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `PG-${year}-${String(sequence).padStart(6, '0')}`;
}

export function qrDataUri(value) {
  const codewords = encodeQrData(value);
  const size = 21;
  const matrix = Array.from({ length: size }, () => Array(size).fill(null));
  const set = (x, y, bit) => {
    if (x >= 0 && x < size && y >= 0 && y < size) matrix[y][x] = Boolean(bit);
  };
  const finder = (originX, originY) => {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const xx = originX + x;
        const yy = originY + y;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const inside = x >= 0 && x <= 6 && y >= 0 && y <= 6;
        const dark = inside && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        set(xx, yy, dark);
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  for (let index = 8; index < size - 8; index += 1) {
    set(index, 6, index % 2 === 0);
    set(6, index, index % 2 === 0);
  }
  set(8, size - 8, true);
  writeFormat(matrix, 0);

  const bits = [];
  for (const word of codewords) {
    for (let bit = 7; bit >= 0; bit -= 1) bits.push((word >>> bit) & 1);
  }
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vert = 0; vert < size; vert += 1) {
      const y = upward ? size - 1 - vert : vert;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        if (matrix[y][x] === null) set(x, y, (bits[bitIndex++] || 0) ^ ((x + y) % 2 === 0 ? 1 : 0));
      }
    }
    upward = !upward;
  }
  writeFormat(matrix, 0);

  const quiet = 4;
  const full = size + quiet * 2;
  const rects = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (matrix[y][x]) rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#102a43">${rects.join('')}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function encodeQrData(value) {
  const bytes = [...new TextEncoder().encode(value)];
  if (bytes.length > 17) throw new Error('Student ID is too long for this QR code.');
  const bits = [];
  const push = (number, length) => {
    for (let index = length - 1; index >= 0; index -= 1) bits.push((number >>> index) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  bytes.forEach((byte) => push(byte, 8));
  const capacity = 19 * 8;
  for (let index = 0; index < Math.min(4, capacity - bits.length); index += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const words = [];
  for (let index = 0; index < bits.length; index += 8) {
    words.push(bits.slice(index, index + 8).reduce((result, bit) => (result << 1) | bit, 0));
  }
  for (let pad = 0; words.length < 19; pad += 1) words.push(pad % 2 === 0 ? 0xec : 0x11);
  return words.concat(reedSolomon(words, 7));
}

function reedSolomon(data, count) {
  const multiply = (left, right) => {
    let result = 0;
    for (let bit = 7; bit >= 0; bit -= 1) {
      result = (result << 1) ^ ((result >>> 7) * 0x11d);
      if ((right >>> bit) & 1) result ^= left;
    }
    return result;
  };
  let generator = [1];
  let root = 1;
  for (let index = 0; index < count; index += 1) {
    const next = Array(generator.length + 1).fill(0);
    generator.forEach((coefficient, position) => {
      next[position] ^= coefficient;
      next[position + 1] ^= multiply(coefficient, root);
    });
    generator = next;
    root = multiply(root, 2);
  }
  const remainder = Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift();
    remainder.push(0);
    for (let index = 0; index < count; index += 1) remainder[index] ^= multiply(generator[index + 1], factor);
  }
  return remainder;
}

function writeFormat(matrix, mask) {
  const size = matrix.length;
  const data = (1 << 3) | mask;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537);
  }
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (index) => ((bits >>> index) & 1) !== 0;
  for (let index = 0; index <= 5; index += 1) matrix[index][8] = bit(index);
  matrix[7][8] = bit(6);
  matrix[8][8] = bit(7);
  matrix[8][7] = bit(8);
  for (let index = 9; index < 15; index += 1) matrix[8][14 - index] = bit(index);
  for (let index = 0; index < 8; index += 1) matrix[8][size - 1 - index] = bit(index);
  for (let index = 8; index < 15; index += 1) matrix[size - 15 + index][8] = bit(index);
}

export async function compressImage(file) {
  if (!file) return '';
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  const url = URL.createObjectURL(file);
  try {
    const source = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const max = 420;
    const ratio = Math.min(1, max / Math.max(source.width, source.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * ratio));
    canvas.height = Math.max(1, Math.round(source.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not process this image.');
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.76);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadCsv(name, rows) {
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
