export function createLocalQueue({ capacity = 1000 } = {}) {
  const items = [];
  return {
    enqueue(name, data, extra = {}) {
      if (items.length >= capacity) return false;
      items.push(Object.assign(extra, { name, data }));
      return true;
    },
    take() {
      return items.shift();
    },
    clear() {
      for(const item of items)item.resolve?.();
      items.length = 0;
    },
    get pending() {
      return items.length;
    },
  };
}
