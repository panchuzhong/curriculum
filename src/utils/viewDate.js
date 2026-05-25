const store = {};

export function setViewDate(view, date) {
  store[view] = date;
}

export function getViewDate(view) {
  return store[view] || null;
}
