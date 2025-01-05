const anyPropIsFalsy = (x: object) => Object.values(x).some((x) => !x);
export default anyPropIsFalsy;
