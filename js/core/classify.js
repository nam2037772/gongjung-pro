// 표준 공종 사전: 건설공사 일반적인 선후관계를 기준으로 order(순번)를 부여한다.
// lane: 'chain'  -> 주공정 순서열에 들어가는 공종 (같은 order 값끼리는 병행 가능한 서브그룹)
//       'parallel' -> 골조 이후~마감 전까지 별도 구간에서 병행 진행하는 공종(전기/설비/통신/소방/금속)
export const CATEGORY_TEMPLATES = [
  { key: "demolition", name: "철거공사", lane: "chain", order: 5,
    keywords: ["철거", "해체", "발파"] },
  { key: "temp", name: "가설공사", lane: "chain", order: 10,
    keywords: ["가설", "규준틀", "비계", "가시설", "안전휀스", "안전펜스", "환경관리비", "품질관리비", "안전관리비", "울타리"] },
  { key: "earth", name: "토공사", lane: "chain", order: 20,
    keywords: ["토공", "토및지정", "굴착", "되메우기", "성토", "절토", "흙깎기", "흙쌓기", "사토", "터파기"] },
  { key: "civil", name: "토목공사", lane: "chain", order: 25,
    keywords: ["토목", "우수공", "오수공", "구조물공", "포장공사", "옹벽블록", "측구"] },
  { key: "foundation", name: "지정 및 기초공사", lane: "chain", order: 30,
    keywords: ["지정공사", "기초공사", "파일공사", "지반보강", "매트기초", "줄기초", "잡석지정"] },
  { key: "concrete", name: "철근콘크리트공사", lane: "chain", order: 40,
    keywords: ["철근콘크리트", "골조공사", "거푸집", "콘크리트공사", "옹벽공사"] },
  { key: "masonry", name: "조적공사", lane: "chain", order: 50,
    keywords: ["조적", "벽돌공사", "블록공사", "돌공사", "담장쌓기", "돌담쌓기"] },
  { key: "metal", name: "금속공사", lane: "chain", order: 50,
    keywords: ["금속공사", "철물공사", "난간공사", "펜스공사", "휀스공사", "판넬공사", "데크공사"] },
  { key: "window", name: "창호공사", lane: "chain", order: 50,
    keywords: ["창호", "유리공사", "샤시", "새시", "도어공사", "문틀"] },
  { key: "electrical", name: "전기공사", lane: "parallel", order: 55,
    keywords: ["전기공사", "조명공사", "수변전", "발전기", "피뢰", "승강기", "엘리베이터"] },
  { key: "mechanical", name: "설비공사", lane: "parallel", order: 55,
    keywords: ["설비공사", "급수", "급탕", "배관", "오배수", "냉난방", "환기", "기계설비", "위생기구", "공조"] },
  { key: "telecom", name: "통신공사", lane: "parallel", order: 55,
    keywords: ["통신공사", "정보통신", "네트워크공사", "방송설비"] },
  { key: "fire", name: "소방공사", lane: "parallel", order: 55,
    keywords: ["소방공사", "스프링클러", "소화설비", "소화기"] },
  { key: "waterproof", name: "방수공사", lane: "chain", order: 60,
    keywords: ["방수", "누수", "홈통", "지붕공사", "지붕및홈통"] },
  { key: "plaster", name: "미장공사", lane: "chain", order: 70,
    keywords: ["미장"] },
  { key: "tile", name: "타일공사", lane: "chain", order: 80,
    keywords: ["타일공사", "석재공사", "스톤공사"] },
  { key: "interior", name: "수장공사", lane: "chain", order: 90,
    keywords: ["수장", "목공사", "천정공사", "경량철골", "인테리어", "마루공사", "바닥재", "도배공사", "가구공사"] },
  { key: "paint", name: "도장공사", lane: "chain", order: 100,
    keywords: ["도장", "칠공사", "페인트", "뿜칠"] },
  { key: "landscape", name: "조경공사", lane: "chain", order: 105,
    keywords: ["조경", "식재공사", "수목"] },
  { key: "fixture", name: "기구 및 마감공사", lane: "chain", order: 110,
    keywords: ["기구공사", "위생기구", "부속철물", "싱크", "주방가구", "장애인편의시설", "간판공사", "기구및", "기구"] },
  { key: "cleaning", name: "준공청소", lane: "chain", order: 120,
    keywords: ["준공청소", "청소공사", "폐기물처리", "폐기물상차"] },
];

const FALLBACK_KEY = "etc";
export const FALLBACK_CATEGORY = { key: FALLBACK_KEY, name: "기타", lane: "chain", order: 115, keywords: [] };

function normalize(name) {
  return String(name || "").replace(/\s+/g, "");
}

// 이름 문자열이 어떤 표준 공종과 매칭되는지 찾는다. 매칭 실패 시 null.
export function matchCategory(rawName) {
  const name = normalize(rawName);
  if (!name) return null;
  let best = null;
  let bestLen = 0;
  for (const cat of CATEGORY_TEMPLATES) {
    for (const kw of cat.keywords) {
      if (name.includes(kw) && kw.length > bestLen) {
        best = cat;
        bestLen = kw.length;
      }
    }
  }
  return best;
}

// items: [{ name, spec, amount, ancestorNames: [자기이름, 부모이름, 조부모이름...] }]
// 자기 이름에서 매칭 실패 시 상위(부모) 이름으로 순차 매칭을 시도한다.
export function classifyItem(item) {
  const chain = item.ancestorNames && item.ancestorNames.length ? item.ancestorNames : [item.name];
  for (const candidate of chain) {
    const matched = matchCategory(candidate);
    if (matched) return matched;
  }
  return FALLBACK_CATEGORY;
}

// rows: [{ name, spec, amount, code, parentCode }]
// leaf-and-ancestor-walk 방식으로 그룹핑하여 카테고리 배열을 만든다.
export function autoClassify(rows) {
  const byCode = new Map();
  const hasParent = rows.some((r) => r.parentCode);
  if (hasParent) {
    rows.forEach((r) => {
      if (r.code) byCode.set(r.code, r);
    });
  }
  const childCodeSet = new Set();
  if (hasParent) {
    rows.forEach((r) => {
      if (r.parentCode) childCodeSet.add(r.parentCode);
    });
  }

  const leaves = hasParent ? rows.filter((r) => !r.code || !childCodeSet.has(r.code)) : rows;

  const groups = new Map(); // key -> { key, name, amount, items: [] }

  leaves.forEach((leaf) => {
    const ancestorNames = [leaf.name];
    if (hasParent) {
      let cur = leaf;
      const seen = new Set([cur.code]);
      while (cur && cur.parentCode && byCode.has(cur.parentCode) && !seen.has(cur.parentCode)) {
        cur = byCode.get(cur.parentCode);
        ancestorNames.push(cur.name);
        seen.add(cur.parentCode);
      }
    }
    const cat = classifyItem({ name: leaf.name, ancestorNames });
    if (!groups.has(cat.key)) {
      groups.set(cat.key, { key: cat.key, name: cat.name, lane: cat.lane, order: cat.order, amount: 0, items: [] });
    }
    const g = groups.get(cat.key);
    g.amount += leaf.amount || 0;
    g.items.push(leaf);
  });

  return Array.from(groups.values()).sort((a, b) => a.order - b.order);
}

export function cleanItemName(raw) {
  let s = String(raw || "").trim();
  // 앞의 공종코드 숫자 제거 (예: "010104  철근콘크리트공사")
  s = s.replace(/^\d{2,}\s*/, "");
  // 강조용 역삼각형 기호 제거
  s = s.replace(/[▼▽]/g, "").trim();
  // 글자 사이를 벌린 2칸 이상 공백을 제거 (예: "타  일  공  사" -> "타일공사")
  s = s.replace(/\s{2,}/g, "");
  return s.trim();
}
