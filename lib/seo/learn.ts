// /learn 해설 페이지 본문 — 손님이 검색·AI 에 실제로 묻는 정보성 질문에 답한다.
//   (네이버 자동완성 관찰: 'a2 우유 뜻', 'a2우유 차이', 'a2 단백질', '저지우유 뜻',
//    '헤이밀크/건초우유 뜻', '저탄소 우유란', '동물복지 우유 뜻', '목초우유')
//
//   ★ 첫 문단(intro)이 곧 답이다 — 검색 스니펫·AI 답변이 가장 먼저 가져가는 자리.
//   ★ 소제목은 질문형, 본문은 사실만. 바깥 사실은 반드시 '출처'(이름·주소·연도)에 남긴다.
//     확인하지 못한 사실은 쓰지 않는다(틀린 문장보다 빈 문장이 낫다).
//   ★ 금지: 효능·질병·소화 암시, 다른 우유·브랜드·품종과의 비교, 범위 없는 최상급,
//     '건초만'·'풀만'·'방목'(사실과 다름), 인증을 제품 인증처럼 쓰는 표현.
//     lib/seo/learn.test.ts 가 lib/seo/claims.test.ts 와 같은 금지 규칙으로 검사한다.
//   ★ 1885년 저지 이야기는 Dr-Ha--agent/context/korea-jersey-1885-history.md 의 근거 수준만 쓴다:
//     '한국 최초의 젖소'(범위 없이)·'1885년 저지의 후손'·'Since 1885' 금지. 지금 목장의 소는
//     1885년 소의 후손이 아니다.
//   ★ 제품 사실(원재료·살균·영양)은 lib/products.ts, 인증은 lib/certifications.ts 에서만 가져온다.
//     인증 목록은 호출부가 오늘(KST) 기준 activeCertifications 로 넘긴다(만료 인증 자동 제외).
import { PUBLIC_PRODUCTS, type Product } from "@/lib/products";
import { SITE_URL } from "@/lib/site";
import { certValidityLabel, type Certification } from "@/lib/certifications";

export type LearnSource = {
  /** 출처 이름(기관·문서명·저자) */
  name: string;
  /** https 주소 */
  url: string;
  /** 발행(최종 수정) 연도. accessed 이면 날짜가 없는 공식 페이지를 열람한 연도. */
  year: number;
  /** 발행일이 따로 없는 페이지 — 화면에 '열람'으로 적는다. */
  accessed?: boolean;
};

export type LearnSection = {
  /** 질문형 소제목(H2) */
  heading: string;
  paragraphs: readonly string[];
};

export type LearnPage = {
  slug: string;
  /** H1 이자 <title>(접미사 ' · 송영신목장' 앞). 40자 이내, 같은 낱말 반복 금지. */
  title: string;
  /** 메타 설명 60–130자 */
  description: string;
  /** 처음 공개한 날 YYYY-MM-DD (Article.datePublished) */
  published: string;
  /** 내용이 마지막으로 바뀐 날 YYYY-MM-DD — 화면 '최종 업데이트'·sitemap lastmod·Article.dateModified */
  updated: string;
  /** 첫 문단 = 질문에 대한 바로 그 답(결론) */
  intro: string;
  sections: readonly LearnSection[];
  sources: readonly LearnSource[];
  /** 구조화데이터 Article.about — 이 글이 다루는 주제 이름 */
  about: readonly string[];
};

export const LEARN_PAGES: readonly LearnPage[] = [
  {
    slug: "a2-milk",
    title: "A2 우유란 — 뜻과 A1형과의 차이",
    description:
      "A2 우유는 우유 단백질 베타카제인 가운데 A2형만 든 우유입니다. A1형과 다른 점(67번째 아미노산), A2/A2 소의 유전자형, 유당이 그대로 있다는 점을 출처와 함께 정리했습니다.",
    published: "2026-11-12",
    updated: "2026-11-12",
    intro:
      "A2 우유는 우유 단백질의 하나인 베타카제인(β-casein) 가운데 A2형만 들어 있는 우유입니다. A2형 베타카제인만 만드는 유전자형(A2/A2)의 젖소에게서 짠 원유로 만듭니다. 'A2'는 단백질의 종류를 가리키는 말이며, 우유의 유당(락토스)은 그대로 들어 있습니다.",
    sections: [
      {
        heading: "베타카제인 A1형과 A2형은 무엇이 다른가요?",
        paragraphs: [
          "우유 단백질은 크게 카제인과 유청 단백질로 나뉘고, 베타카제인은 카제인의 한 종류입니다. 소의 베타카제인에는 유전적으로 여러 변이형이 알려져 있으며, 미국낙농학회(ADSA) 명명위원회가 A1·A2·B 같은 이름으로 정리해 왔습니다.",
          "A1형과 A2형을 가르는 대표적인 차이는 단백질 사슬의 67번째 아미노산입니다. A2형은 이 자리에 프롤린(Pro)을, A1형은 히스티딘(His)을 가지고 있습니다. 단백질 데이터베이스 UniProt 은 신호 서열까지 세는 번호로 82번째 자리에 이 차이를 기록하고 있습니다.",
        ],
      },
      {
        heading: "어떤 소가 A2 우유를 내나요?",
        paragraphs: [
          "소가 어떤 베타카제인을 만드는지는 부모에게서 하나씩 물려받은 유전자 두 개, 곧 유전자형으로 정해집니다. 유전자형이 A2/A2인 소는 A2형 베타카제인만 만들고, A1/A2인 소는 두 형태를 함께 만듭니다.",
          "그래서 A2 우유는 유전자 검사로 A2/A2임을 확인한 소의 원유만 모아 만듭니다. 국내에서는 농촌진흥청이 2025년 11월 젖소 씨수소의 유전체 정보에 베타카제인 유전자형을 넣어 공개하면서, A2 우유 생산을 계획하는 농가는 A2A2형으로 표기된 씨수소를 골라 쓸 수 있다고 안내했습니다.",
        ],
      },
      {
        heading: "A2 우유에도 유당이 들어 있나요?",
        paragraphs: [
          "네. A1과 A2는 단백질(베타카제인)의 종류에 대한 구분이고, 우유의 당인 유당(락토스)과는 관계가 없습니다. A2 우유에도 유당이 그대로 들어 있으며, 무유당(락토프리) 제품이 아닙니다.",
          "유당이 얼마나 들었는지 알고 싶다면 제품 영양정보의 '당류'를 보면 됩니다. 원재료가 원유뿐인 우유라면 표시된 당류는 우유 본래의 당(주로 유당)입니다.",
        ],
      },
      {
        heading: "'A2'라는 표시는 무엇을 알려 주나요?",
        paragraphs: [
          "'A2'는 원유를 낸 소들의 베타카제인 유전자형에 대한 정보입니다. 맛이나 지방·단백질 함량, 살균 방식을 뜻하는 표시가 아니므로, 그런 내용은 제품의 표시사항과 영양정보에서 따로 확인해야 합니다.",
          "이 글은 A2 우유의 정의와 구분만 다룹니다. 식품의 기능성이나 효능에 대한 내용은 다루지 않습니다.",
        ],
      },
    ],
    sources: [
      {
        name: "UniProt — P02666 (CASB_BOVIN) Beta-casein, Bos taurus",
        url: "https://www.uniprot.org/uniprotkb/P02666/entry",
        year: 2026,
      },
      {
        name: "Farrell H.M. 외, Nomenclature of the Proteins of Cows' Milk — Sixth Revision, Journal of Dairy Science 87(6):1641–1674",
        url: "https://doi.org/10.3168/jds.S0022-0302(04)73319-6",
        year: 2004,
      },
      {
        name: "농촌진흥청 보도자료 「젖소 씨수소, 이제 '유전체 유전능력'으로 선택하세요」(2025-11-12)",
        url: "https://www.rda.go.kr/board/board.do?mode=view&prgId=day_farmprmninfoEntry&dataNo=100000806070",
        year: 2025,
      },
    ],
    about: ["A2 우유", "베타카제인"],
  },
  {
    slug: "jersey-milk",
    // '한국의 첫 젖소'(범위 없는 '최초')는 쓰지 않는다 — 근거 수준: korea-jersey-1885-history.md.
    title: "저지 우유란 — 그리고 1885년 조선에 온 젖소",
    description:
      "저지 우유는 영국해협 저지섬에서 생겨난 젖소 품종 저지(Jersey)의 우유입니다. 품종의 유래와, 1885년 미국 외교문서에 남은 조선의 저지 젖소 도입 기록을 출처와 함께 정리했습니다.",
    published: "2026-11-12",
    updated: "2026-11-12",
    intro:
      "저지 우유는 영국과 프랑스 사이 해협의 작은 섬 저지(Jersey)에서 만들어진 젖소 품종, 저지에게서 짠 우유입니다. 한국과 저지의 인연은 1885년으로 거슬러 올라갑니다. 그해 9월 서울 주재 미국 외교관이 본국에 보낸 보고서에, 조선 정부 농장이 미국 캘리포니아에서 저지 암소 2두와 수소 1두를 들여왔다는 기록이 남아 있습니다.",
    sections: [
      {
        heading: "저지는 어디에서 온 품종인가요?",
        paragraphs: [
          "저지는 영국과 프랑스 사이 해협에 있는 채널제도의 섬, 저지에서 만들어진 젖소 품종입니다. 저지섬은 200년 넘게 살아 있는 소와 정액·수정란의 반입을 제한해 왔고, 정액 반입은 2008년에야 허용되었습니다.",
          "저지섬의 소는 세계 여러 나라로 퍼져 각지에 저지 집단을 이루었습니다. 캐나다에는 1868년 퀘벡에 처음 들어왔고, 미국에서는 같은 해 미국저지소협회(AJCA)가 조직될 만큼 19세기에 이미 저지가 자리를 잡고 있었습니다.",
        ],
      },
      {
        heading: "1885년 조선에 온 저지 젖소는 어떤 기록에 남아 있나요?",
        paragraphs: [
          "1885년 9월 4일, 서울에 있던 미국 대리공사 조지 C. 포크(George C. Foulk)가 국무장관에게 보낸 보고서가 미국 외교문서집(FRUS 1885, 문서 247)에 실려 있습니다. 보고서는 조선 정부 농장의 책임자가 캘리포니아의 번식용 가축을 사들였고, 그 가축이 보고 약 두 달 전에 도착했다고 적고 있습니다.",
          "들여온 가축 가운데 저지 암소 2두와 수소 1두, 모두 3두가 있었고 말과 셰틀랜드 조랑말, 돼지, 양도 함께 들어왔습니다. 한국민족문화대백과사전은 이 일을 '저지종 2두'로 적고 국내 젖소 사육의 효시로 소개합니다. 현재 확인되는 기록으로는 서양 젖소 품종이 한국에 들어온 가장 이른 사례입니다.",
        ],
      },
      {
        heading: "그 저지 소들은 누가, 어디에서 길렀나요?",
        paragraphs: [
          "책임자는 1883년 미국에 간 조선 사절단(보빙사)을 수행한 무관 최경석입니다. 포크는 그를 '정부 농부(the Government farmer)'라고 불렀고, 고종은 그에게 가축과 말을 번식·개량할 땅을 내주었습니다. 한국민족문화대백과사전은 이 농장을 농무목축시험장으로 소개하며, 1885년 두 차례에 걸쳐 미국에서 들여온 말·소·젖소·돼지·양을 길렀다고 적고 있습니다.",
          "여러 품종 가운데 왜 저지를 골랐는지는 기록에 남아 있지 않습니다. 이후 1902년에는 대한제국 농상공부 기사였던 프랑스인 쇼트(Short)가 홀스타인 20마리를 들여오면서 젖소 시험 사육이 본격화되었습니다.",
        ],
      },
      {
        heading: "저지 우유와 A2 우유는 같은 말인가요?",
        paragraphs: [
          "아닙니다. '저지'는 소의 품종이고, 'A2'는 소가 만드는 베타카제인의 유전자형에 대한 구분입니다. 저지 품종 안에도 A1/A1, A1/A2, A2/A2 소가 섞여 있어, 저지 우유라고 해서 모두 A2 우유인 것은 아닙니다.",
          "A2 저지 우유는 유전자 검사로 A2/A2임을 확인한 저지 소의 원유로 만든 우유를 말합니다.",
        ],
      },
    ],
    sources: [
      {
        name: "Foreign Relations of the United States, 1885, Document 247 — George C. Foulk to Secretary of State Bayard, 1885-09-04 (미국 국무부 Office of the Historian)",
        url: "https://history.state.gov/historicaldocuments/frus1885/d247",
        year: 1885,
      },
      {
        name: "한국민족문화대백과사전 「가축」(한국학중앙연구원)",
        url: "https://encykorea.aks.ac.kr/Article/E0000383",
        year: 2022,
      },
      {
        name: "한국민족문화대백과사전 「농무목축시험장」(한국학중앙연구원)",
        url: "https://encykorea.aks.ac.kr/Article/E0013097",
        year: 2023,
      },
      {
        name: "Jersey Canada — History of the Jersey Breed",
        url: "https://jerseycanada.com/jersey-history/",
        year: 2026,
        accessed: true,
      },
      {
        name: "American Jersey Cattle Association(미국저지소협회)",
        url: "https://usjersey.com/",
        year: 2026,
        accessed: true,
      },
      {
        name: "Cartuche-Macas L.F. 외, Differential A1/A2 β-casein (CSN2) gene-derived allelic and genotypic frequencies across Ecuadorian exotic dairy cattle breeds, Frontiers in Veterinary Science 12:1616426",
        url: "https://doi.org/10.3389/fvets.2025.1616426",
        year: 2025,
      },
    ],
    about: ["저지 (소 품종)", "한국 낙농의 역사"],
  },
  {
    slug: "hay-milk",
    title: "헤이밀크(건초우유)란 — 사일리지 없는 낙농 방식",
    description:
      "헤이밀크는 사일리지(발효사료) 없이 풀과 건초를 중심으로 먹인 소의 우유입니다. EU가 2016년 전통특산물보증(TSG)으로 등록한 기준과, 송영신목장이 EU 인증 제품이 아닌 점을 정리했습니다.",
    published: "2026-11-12",
    updated: "2026-11-13",
    intro:
      "헤이밀크(독일어 Heumilch, 영어 Haymilk)는 사일리지(발효사료)를 먹이지 않고, 풀이 자라는 철에는 신선한 풀을, 겨울에는 건초를 중심으로 먹인 소에게서 짠 우유입니다. 유럽연합(EU)은 2016년 오스트리아의 신청(신청 단체 ARGE Heumilch Österreich)을 받아 'Heumilch/Haymilk'를 전통특산물보증(TSG)으로 등록했습니다. 송영신목장은 사일리지(발효사료) 없이 건초를 중심으로 먹이는 헤이밀크 방식을 따르지만, EU TSG 인증 제품은 아니며 EU 사양의 세부 기준(조사료 비율·GM 사료·부산물 등)을 검증받은 것도 아닙니다.",
    sections: [
      {
        heading: "헤이밀크를 내는 소는 무엇을 먹나요?",
        paragraphs: [
          "EU에 등록된 헤이밀크 생산 사양(위원회 시행규정 (EU) 2016/304 부속서)에 따르면, 소는 풀 사료 철에 신선한 풀과 콩과 식물, 잎을 주로 먹고 겨울에는 건초를 주로 먹습니다. 1년 동안 먹이는 사료를 수분을 뺀 무게로 따지면 그 대부분을 조사료로 채워야 하며, 신선한 풀과 건초 말고도 풋베기(청예) 옥수수·사료용 비트, 건초·알팔파 펠릿도 조사료로 칩니다. 밀·보리·귀리·옥수수 같은 곡물과 잠두·완두·루핀 같은 콩류도 허용됩니다.",
          "금지되는 것은 사일리지(발효사료)와 젖은 건초, 발효 건초입니다. 양조·증류 부산물 같은 식품 산업 부산물(설탕 제조 부산물인 건조 비트 펄프·당밀과 곡물 가공에서 나온 건조 단백질 사료는 예외)과, 유전자변형(GM)으로 표시해야 하는 사료와 동물도 쓸 수 없습니다.",
        ],
      },
      {
        heading: "사일리지(발효사료)는 무엇인가요?",
        paragraphs: [
          "사일리지는 풀이나 옥수수 같은 사료작물을 밀봉해 발효시킨 사료입니다. EU 등록 문서는 1960년대 이후 농업 기계화와 함께 사일리지에 기대는 사육이 늘었고, 헤이밀크는 발효 사료를 쓰지 않던 그 이전의 방식을 잇는다고 설명합니다.",
          "EU 사양은 헤이밀크 농장에서 사일리지와, 비닐로 감싼 원형 곤포(베일)를 만들거나 보관하는 것도 금지합니다.",
        ],
      },
      {
        heading: "EU 전통특산물보증(TSG)은 무엇인가요?",
        paragraphs: [
          "전통특산물보증(Traditional Speciality Guaranteed, TSG)은 생산 지역이 아니라 전통적인 생산 방법을 보호하는 EU의 품질 제도입니다. ARGE Heumilch는 이 표시가 제품의 생산 방법에 관한 것이며, '전통'은 그 방법이 30년 이상 쓰여 왔다는 뜻이라고 설명합니다.",
          "EU는 2016년 3월 2일 위원회 시행규정 (EU) 2016/304 로 'Heumilch/Haymilk/Latte fieno/Lait de foin/Leche de heno'를 TSG로 등록했습니다. 이름 보호를 포함한 등록이어서, EU에서 이 이름은 등록된 사양을 지키는 제품에 쓰도록 되어 있습니다. 등록 문서는 중세부터 알프스 기슭과 티롤 산지에서 헤이밀크로 치즈를 만들어 왔다고 전통의 근거를 적고 있습니다.",
        ],
      },
      {
        heading: "EU 헤이밀크는 누가 검사하나요?",
        paragraphs: [
          "EU 헤이밀크(TSG)는 농장과 가공업체가 모두 독립 기관의 검사를 받는 제도입니다. ARGE Heumilch의 인증 프로그램에 따르면 ISO/IEC 17065 인정 인증기관이 농장마다 처음 현장 검사를 하고, 가공업체는 적어도 1년에 한 번 검사를 받습니다.",
        ],
      },
      {
        heading: "ARGE Heumilch는 어떤 단체인가요?",
        paragraphs: [
          "ARGE Heumilch는 오스트리아 인스브루크에 등록된 헤이밀크 단체로, 약 6,500명의 헤이밀크 농민과 낙농·치즈 가공업체, 유통업체가 모여 있습니다. 단체에 따르면 헤이밀크 산지는 대부분 알프스에 있고, 오스트리아 전체 우유 납품량의 15%가 헤이밀크입니다.",
          "회원은 EU TSG 기준에 더해 단체 규정을 지키며, 이 규정은 유럽 밖에서 생산된 사료와 팜유·코코넛 지방이 든 사료도 금지합니다. 초록색 헤이밀크 로고는 회원만 쓸 수 있습니다.",
        ],
      },
      {
        heading: "송영신목장 우유는 EU 인증 헤이밀크인가요?",
        paragraphs: [
          "아닙니다. 송영신목장은 사일리지(발효사료) 없이 건초를 중심으로 먹이는 헤이밀크 방식을 따라 소를 기르지만, EU의 TSG 검증·인증을 받은 제품은 아닙니다.",
          "송영신목장은 ARGE Heumilch 회원이 아니며, 제품과 포장에 ARGE Heumilch 로고나 EU TSG 표장을 쓰지 않습니다. 현재 국내에는 헤이밀크를 인증하는 제도가 없습니다.",
          "제품 이름의 '헤이밀크'는 이 사육 방식을 따른다는 뜻으로 씁니다. 유기(유기농) 인증을 받은 제품도 아닙니다.",
        ],
      },
    ],
    sources: [
      {
        name: "Commission Implementing Regulation (EU) 2016/304 of 2 March 2016 — Heumilch/Haymilk (TSG) 등록, OJ L 58, 4.3.2016, pp. 28–34 (EUR-Lex)",
        url: "https://eur-lex.europa.eu/eli/reg_impl/2016/304/oj",
        year: 2016,
      },
      {
        name: "같은 규정 전문(부속서 헤이밀크 생산 사양 포함, EUR-Lex 영문 HTML)",
        url: "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0304",
        year: 2016,
      },
      {
        name: "ARGE Heumilch — Quality seal T.S.G.",
        url: "https://www.heumilch.com/en/heumilch/quality_seal",
        year: 2026,
        accessed: true,
      },
      {
        name: "ARGE Heumilch — ARGE Heumilch(단체 소개)",
        url: "https://www.heumilch.com/en/heumilch/arge-heumilch",
        year: 2026,
        accessed: true,
      },
      {
        name: "ARGE Heumilch — Heumilch-Regulativ(단체 규정 요약, 독일어)",
        url: "https://www.heumilch.com/heumilch/regulativ",
        year: 2026,
        accessed: true,
      },
      {
        name: "ARGE Heumilch — Zertifizierungsprogramm Heumilch g.t.S., Version 6(2026-01-01 시행), PDF",
        url: "https://www.heumilch.com/wp-content/uploads/2025/11/Zertifizierungsprogramm-Heumilch-gtS-V6_2026_01_01_FINAL.pdf",
        year: 2025,
      },
      {
        name: "ARGE Heumilch 블로그 「Seit 10 Jahren durch EU-Gütesiegel geschützt」(2026-10-14)",
        url: "https://www.heumilch.com/blog/seit-10-jahren-geschuetzt-wo-heumilch-draufsteht-muss-auch-heumilch-drin-sein",
        year: 2026,
      },
      {
        name: "ARGE Heumilch 보도자료 「Erfreuliche Bilanz für die ARGE Heumilch」(2020-01-29)",
        url: "https://www.heumilch.com/presse/erfreuliche-bilanz-fuer-die-arge-heumilch",
        year: 2020,
      },
    ],
    about: ["헤이밀크", "사일리지", "전통특산물보증(TSG)", "ARGE Heumilch"],
  },
  {
    slug: "certified-farm",
    title: "동물복지·저탄소·HACCP 인증 목장이란",
    description:
      "동물복지축산농장 인증, 저탄소 축산물 인증, 안전관리인증(HACCP) 농장이 각각 무엇을 심사하는지, 왜 '인증 우유'가 아니라 '인증 목장'인지 공식 기관 자료로 정리했습니다.",
    published: "2026-11-12",
    updated: "2026-11-12",
    intro:
      "동물복지축산농장 인증, 저탄소 축산물 인증, 축산물 안전관리인증(HACCP) 농장은 모두 소를 기르고 젖을 짜는 '농장'을 심사하는 국가 인증입니다. 사육 환경과 관리, 온실가스 배출, 위생 관리를 정해진 기준으로 확인하며, 우유나 요거트 같은 가공 제품을 심사하는 인증이 아닙니다. 그래서 이런 인증을 받은 곳은 '인증 목장'이라고 부르는 것이 정확합니다.",
    sections: [
      {
        heading: "동물복지축산농장 인증은 무엇을 심사하나요?",
        paragraphs: [
          "「동물보호법」 제59조에 따라 농림축산식품부가 운영하는 제도로, 농장동물이 본래의 습성을 유지하며 정상적으로 살 수 있도록 관리하는 축산농장을 인증합니다. 2012년 산란계 농장부터 시작했고, 젖소 농장은 2015년부터 인증 대상이 되었습니다.",
          "인증 심사는 축산환경관리원이 맡습니다. 서류심사 뒤 인증심사원 2명 이상이 농장을 찾아 축종별 기준에 따라 현장심사를 하고, 인증 농장은 해마다 사후관리를 받습니다. 개정 「동물보호법」의 해당 규정이 시행된 2024년 4월 27일 이후 새로 인증받은 농장의 유효기간은 3년이며, 기간이 끝나기 전에 갱신 심사를 받아야 합니다.",
        ],
      },
      {
        heading: "저탄소 축산물 인증은 무엇을 심사하나요?",
        paragraphs: [
          "농림축산식품부의 저탄소 축산물 인증은 생산 과정에 저탄소 축산 기술을 적용해, 온실가스 배출량을 축종별 평균 대비 10% 이상 줄인 농장을 인증하는 제도로, 한우·돼지·젖소 농장을 대상으로 시범 운영되고 있습니다(2025년 3월 농림축산식품부 발표 기준).",
          "신청은 축산물품질평가원이 받으며, 배출량 산정과 현장 심사, 전문가 검토를 거쳐 인증 농장을 정합니다. 신청하려면 무항생제축산·유기축산·HACCP·동물복지 같은 기존 축산 인증 가운데 하나 이상을 갖추고 있어야 합니다.",
        ],
      },
      {
        heading: "안전관리인증(HACCP) 농장은 무엇을 심사하나요?",
        paragraphs: [
          "축산물 안전관리인증기준(HACCP)은 해로운 물질이 축산물에 섞이거나 축산물이 오염되는 것을 막기 위해, 각 과정의 위해요소를 확인·평가해 중점적으로 관리하는 기준입니다. 근거 법령은 「축산물 위생관리법」 제9조입니다.",
          "작업장·업소뿐 아니라 가축을 기르는 농장도 '안전관리인증농장'으로 인증받을 수 있으며, 인증 신청과 심사는 한국식품안전관리인증원이 맡습니다. 농장 HACCP는 농장 단계의 위생 관리를 보는 인증으로, 우유를 살균하고 병에 담는 가공 공정의 인증과는 별개입니다.",
        ],
      },
      {
        heading: "왜 '인증 우유'가 아니라 '인증 목장'이라고 하나요?",
        paragraphs: [
          "세 인증 모두 심사 대상이 농장의 사육·관리·위생입니다. 우유의 살균이나 요거트의 발효 같은 가공 단계, 제품의 성분을 심사한 결과가 아니므로, 제품 이름 앞에 인증명을 붙이면 제품 자체가 인증받은 것처럼 읽힐 수 있습니다.",
          "동물복지축산농장 인증 제도에는 인증 농장에서 생산된 축산물에 인증 마크를 표시하는 규정도 있지만, 그 마크 역시 '인증 농장에서 왔다'는 뜻입니다. 유기(유기농) 축산물 인증은 이 세 인증과 별개의 제도입니다.",
        ],
      },
    ],
    sources: [
      {
        name: "축산환경관리원 「동물복지축산 인증 소개」",
        url: "https://www.lemi.or.kr/contents.do?menuno=260",
        year: 2026,
        accessed: true,
      },
      {
        name: "축산환경관리원 「동물복지축산 인증 절차」",
        url: "https://www.lemi.or.kr/contents.do?menuno=262",
        year: 2026,
        accessed: true,
      },
      {
        name: "국가동물보호정보시스템(농림축산식품부) 「동물복지 축산인증제 소개」",
        url: "https://www.animal.go.kr/front/community/show.do?boardId=contents&seq=170&menuNo=3000000018",
        year: 2026,
        accessed: true,
      },
      {
        name: "농림축산식품부 보도자료 「축산도 탄소중립 기여 가능! 저탄소 축산물 인증제 참여하세요!」(2025-03-26)",
        url: "https://www.mafra.go.kr/bbs/home/792/573691/artclView.do",
        year: 2025,
      },
      {
        name: "법제처 찾기쉬운 생활법령정보 「축산물 안전관리인증기준」",
        url: "https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=1011&ccfNo=4&cciNo=2&cnpClsNo=1",
        year: 2026,
      },
      {
        name: "한국식품안전관리인증원",
        url: "https://www.haccp.or.kr",
        year: 2026,
        accessed: true,
      },
    ],
    about: ["동물복지축산농장 인증", "저탄소 축산물 인증", "축산물 안전관리인증기준(HACCP)"],
  },
];

/** /learn 허브 — 제목·설명·마지막 변경일(글 가운데 가장 늦은 날). */
export const LEARN_HUB = {
  path: "/learn",
  title: "알아보기 — A2 우유·저지·헤이밀크·인증 목장",
  description:
    "A2 우유의 뜻, 저지 우유와 1885년 조선의 저지 젖소 기록, 헤이밀크(건초우유)와 EU 전통특산물보증, 동물복지·저탄소·HACCP 인증 목장의 의미를 출처와 함께 설명합니다.",
  updated: LEARN_PAGES.map((p) => p.updated).sort().at(-1) as string,
} as const;

export const LEARN_SLUGS = LEARN_PAGES.map((p) => p.slug);

export const learnPath = (slug: string) => `/learn/${slug}`;

export function getLearnPage(slug: string): LearnPage | undefined {
  return LEARN_PAGES.find((p) => p.slug === slug);
}

/** "2026-11-12" → "2026년 11월 12일" */
export function formatKoDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

// ───────── '송영신목장에서는' 상자 ─────────
//   해설(일반 사실) 아래, 이 목장에 대한 사실만 짧게. 제품·인증 SSOT 에서 조립한다.

export type LearnFarmNote = {
  paragraphs: string[];
  /** 목록으로 보일 줄(인증 목록 등). 없으면 빈 배열. */
  list: string[];
  links: { href: string; label: string }[];
};

const firstPart = (s: string | undefined) => (s ?? "").split(" · ")[0].trim();

function productLinks(products: readonly Product[], lines: readonly Product["line"][]) {
  return products
    .filter((p) => lines.includes(p.line))
    .map((p) => ({ href: `/products/${p.id}`, label: `${p.name} ${p.volume}` }));
}

const FAQ_LINK = { href: "/faq", label: "자주 묻는 질문" };
const STORY_LINK = { href: "/story", label: "목장 이야기" };

export type LearnFarmNoteInput = {
  /** 오늘(KST) 기준 유효한 농장 인증 — activeCertifications(kstYmd(...)) */
  certifications: readonly Certification[];
  /** 손님에게 공개된 제품. 생략하면 PUBLIC_PRODUCTS. */
  products?: readonly Product[];
};

export function learnFarmNote(slug: string, input: LearnFarmNoteInput): LearnFarmNote {
  const products = input.products ?? PUBLIC_PRODUCTS;
  const milk = products.find((p) => p.line === "milk");
  const yogurt = products.find((p) => p.line === "yogurt");
  const milkIngredients = firstPart(milk?.label.ingredients);
  const yogurtIngredients = firstPart(yogurt?.label.ingredients);
  const sterilization = firstPart(milk?.label.sterilization);

  switch (slug) {
    case "a2-milk":
      return {
        paragraphs: [
          ...(milkIngredients
            ? [`송영신목장 우유의 원재료는 제품 표시사항 기준 '${milkIngredients}'입니다.`]
            : []),
          ...(yogurtIngredients
            ? [
                `플레인 요거트의 원재료는 '${yogurtIngredients}'이며, 12시간 발효하고 설탕을 넣지 않습니다.`,
              ]
            : []),
          "A2는 단백질 유형에 관한 표시이며, 송영신목장은 제품의 건강 효능을 표시하지 않습니다. 우유에는 유당이 그대로 들어 있습니다.",
        ],
        list: [],
        links: [...productLinks(products, ["milk", "yogurt"]), FAQ_LINK],
      };
    case "jersey-milk":
      return {
        paragraphs: [
          "송영신목장은 경기도 안성에서 A2/A2 저지를 기릅니다. 지금의 소들은 1885년에 들어온 소들의 후손이 아닙니다.",
          ...(milkIngredients
            ? [`우유의 원재료는 제품 표시사항 기준 '${milkIngredients}'입니다.`]
            : []),
        ],
        list: [],
        links: [...productLinks(products, ["milk"]), STORY_LINK, FAQ_LINK],
      };
    case "hay-milk":
      return {
        paragraphs: [
          "송영신목장은 사일리지(발효사료) 없이 건초를 중심으로 먹여 A2/A2 저지를 기릅니다. 유럽 헤이밀크 방식을 따르지만, EU 전통특산물보증(TSG) 인증 제품은 아닙니다.",
          ...(sterilization ? [`우유의 살균 방법은 제품 표시사항 기준 '${sterilization}'입니다.`] : []),
        ],
        list: [],
        links: [...productLinks(products, ["milk"]), STORY_LINK, FAQ_LINK],
      };
    case "certified-farm": {
      const certs = input.certifications;
      return {
        paragraphs:
          certs.length > 0
            ? [
                "송영신목장이 지금 보유한 인증입니다(유효기간이 지난 인증은 표시하지 않습니다).",
                "모두 목장(젖소 사육·착유 단계)에 대한 인증이며 제품 인증이 아닙니다. 유기(유기농) 인증은 받지 않았습니다.",
              ]
            : ["지금 표시할 수 있는 유효한 목장 인증이 없습니다. 유기(유기농) 인증은 받지 않았습니다."],
        list: certs.map(
          (c) => `${c.name} — ${c.issuer}, ${c.number}, ${certValidityLabel(c)} (인증 대상: ${c.scope})`
        ),
        links: [FAQ_LINK, STORY_LINK],
      };
    }
    default:
      return { paragraphs: [], list: [], links: [] };
  }
}

/** 한 페이지의 손님이 읽는 글 전체(제목·설명·본문) — 금지 표현 검사용. */
export function learnPageText(page: LearnPage): string {
  return [
    page.title,
    page.description,
    page.intro,
    ...page.sections.flatMap((s) => [s.heading, ...s.paragraphs]),
  ].join("\n");
}

// ───────── 통합용(오케스트레이터가 sitemap·llms 에 붙인다) ─────────

/** sitemap 항목: 경로 + 마지막 내용 변경일. 허브가 먼저. */
export function learnSitemapEntries(): { path: string; updated: string }[] {
  return [
    { path: LEARN_HUB.path, updated: LEARN_HUB.updated },
    ...LEARN_PAGES.map((p) => ({ path: learnPath(p.slug), updated: p.updated })),
  ];
}

/** llms.txt 의 H2 '알아보기' 아래에 넣을 링크 줄(llmstxt.org 형식: - [이름](주소): 설명). */
export function learnLlmsLines(): string[] {
  return [
    `- [알아보기](${SITE_URL}${LEARN_HUB.path}): A2 우유·저지·헤이밀크·인증 목장 해설 모음`,
    ...LEARN_PAGES.map((p) => `- [${p.title}](${SITE_URL}${learnPath(p.slug)}): ${p.description}`),
  ];
}
