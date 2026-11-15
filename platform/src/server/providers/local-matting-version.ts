export const LOCAL_MATTING_PROTOCOL = 'yingzao-local-matting-v2';
export const LOCAL_MATTING_ALGORITHM = 'lite-linear-cf-ml-v6';
export const LOCAL_MATTING_MODEL_SHA256 =
  '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333';
export const LOCAL_MATTING_MODEL_BYTES = 224005088;
export const LOCAL_MATTING_MAX_PIXELS = 6_000_000;
export const LOCAL_MATTING_PYTHON_VERSIONS = {
  python: '3.12.13',
  pymatting: '1.1.16',
  numpy: '2.5.4',
  scipy: '1.18.1',
  numba: '0.68.1',
  llvmlite: '0.50.0',
  Pillow: '13.0.0',
};
/** Filled only after the reviewed helpers are frozen; never accepted from clients. */
export const LOCAL_MATTING_HELPER_SHA256: Record<string, string> = {
  'controller.py': 'eef9e4b64afeb401fecb183fa4b92f2ebf173ea5ca81aebf7308f984a492ab6c',
  'seed.cjs': 'df95097068a956a509c825df4fce3f2d73ca33d540aec5aed01811347901baf8',
  'matte.py': '23ca33ada080f48325682c9003ca7699581622676f59a7dadb47ea90382d29ed',
};
