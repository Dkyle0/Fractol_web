/** Adapted from Berkeley SoftFloat Release 3e f64_div, approxRecip32_1 and
 * approxRecip_1Ks, John R. Hauser. Copyright 2011-2016 The Regents of the
 * University of California. BSD-3-Clause; see THIRD_PARTY_NOTICES.md.
 * All products/remainders are integer pairs; no floating-point quotient seed.
 * SoftFloat's 10 rounding bits are jammed to pack64's three rounding bits.
 */
export const estimatedDivisionGLSL = `
uint reciprocalEstimate32(uint a) {
  const uint k0[16]=uint[16](0xFFC4u,0xF0BEu,0xE363u,0xD76Fu,0xCCADu,0xC2F0u,0xBA16u,0xB201u,0xAA97u,0xA3C6u,0x9D7Au,0x97A6u,0x923Cu,0x8D32u,0x887Eu,0x8417u);
  const uint k1[16]=uint[16](0xF0F1u,0xD62Cu,0xBFA1u,0xAC77u,0x9C0Au,0x8DDBu,0x8185u,0x76BAu,0x6D3Bu,0x64D4u,0x5D5Cu,0x56B1u,0x50B6u,0x4B55u,0x4679u,0x4211u);
  uint index=(a>>27u)&15u,eps=(a>>11u)&65535u;
  uint r0=(k0[index]-((k1[index]*eps)>>20u))&65535u;
  uint sigma=~ur(product32(r0,a),7).x;
  uint r=(r0<<16u)+ur(product32(r0,sigma),24).x;
  uint square=product32(sigma,sigma).y;
  return r+(product32(r,square).y>>16u);
}
uvec2 ddiv(uvec2 a,uvec2 b) {
  bool sign=ds(a)!=ds(b);
  if(dn(a)||dn(b)||(dz(a)&&dz(b))||(di(a)&&di(b)))return nan64();
  if(di(a)||dz(b))return inf64(sign);
  if(dz(a)||di(b))return uvec2(0u,sign?0x80000000u:0u);
  Parts x=unpack64(a),y=unpack64(b);int exponent=x.e-y.e;
  uvec2 numerator=x.m;
  if(ult(x.m,y.m)){numerator=ul(numerator,11);exponent--;}
  else numerator=ul(numerator,10);
  uvec2 denominator=ul(y.m,11);
  uint reciprocal=reciprocalEstimate32(denominator.y)-2u;
  uint high=product32(numerator.y,reciprocal).y,term=high<<1u;
  uvec2 remainder=usub(ul(usub(numerator,product32(term,denominator.y)),28),product32(term,denominator.x>>4u));
  uint low=product32(remainder.y,reciprocal).y+4u;
  uvec2 quotient=uadd(uvec2(0u,high),ul(uvec2(low,0u),4));
  if((quotient.x&511u)<64u){
    low&=~7u;quotient.x&=~127u;term=low<<1u;
    remainder=usub(ul(usub(remainder,product32(term,denominator.y)),28),product32(term,denominator.x>>4u));
    if((remainder.y&0x80000000u)!=0u)quotient=usub(quotient,uvec2(128u,0u));
    else if(!uzero(remainder))quotient.x|=1u;
  }
  return pack64(sign,exponent,jam(quotient,7));
}
`;
