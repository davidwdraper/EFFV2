export function limitArraySize(max: number) {
  return (val: any[]) => Array.isArray(val) && val.length <= max;
}