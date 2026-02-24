# Báo Cáo: Xu Hướng và Giải Pháp Browser Use / Web Agent

---

## Mục Lục

1. [Tổng Quan](#1-tổng-quan)
2. [Khái Niệm Nền Tảng](#2-khái-niệm-nền-tảng)
3. [Xu Hướng Thế Giới](#3-xu-hướng-thế-giới)
4. [Đánh Giá Năng Lực Thực Tế: "Ảo Tưởng Tiến Bộ"](#4-đánh-giá-năng-lực-thực-tế-ảo-tưởng-tiến-bộ)
5. [WebWorld: Huấn Luyện Agent Ở Quy Mô Lớn](#5-webworld-huấn-luyện-agent-ở-quy-mô-lớn)
6. [Ứng Dụng Thực Tế của Browser Use](#6-ứng-dụng-thực-tế-của-browser-use)
7. [Thách Thức và Hướng Phát Triển](#9-thách-thức-và-hướng-phát-triển)
8. [Kết Luận](#10-kết-luận)
9. [Tài Liệu Tham Khảo](#11-tài-liệu-tham-khảo)

---

## 1. Tổng Quan

Sự bùng nổ của các Mô hình Ngôn ngữ Lớn (Large Language Models — LLMs) đã mở ra một thế hệ AI Agent hoàn toàn mới: các agent có khả năng tự chủ điều hướng web, thực thi thao tác trên trình duyệt, và hoàn thành nhiệm vụ phức tạp chỉ từ một câu lệnh ngôn ngữ tự nhiên. Xu hướng này — thường được gọi là **Browser Use** hay **Web Agent** — đang nhanh chóng trở thành nền tảng của làn sóng tự động hóa công việc thế hệ mới.

---

## 2. Khái Niệm Nền Tảng

### 2.1 Language Agent (Agent Ngôn Ngữ)

**Language Agent** là các hệ thống tích hợp LLMs để suy luận và giao tiếp bằng ngôn ngữ, từ đó có thể vận hành trong môi trường kỹ thuật số như duyệt web hoặc sử dụng máy tính tương tự cách con người làm [1]. Đây là nền tảng triết học của toàn bộ lĩnh vực Browser Use.

### 2.2 Web Agent

**Web Agent** là một dạng Language Agent chuyên biệt, được trang bị khả năng tương tác với trình duyệt: nhấp, cuộn, nhập liệu, điều hướng URL, quản lý tab, và thực hiện chuỗi hành động nhiều bước để hoàn thành nhiệm vụ. Chúng vận hành trực tiếp trên web thực, phân biệt với các hệ thống làm việc trên snapshot tĩnh hay môi trường sandbox.

### 2.3 Computer Use Agent

**Computer Use Agent** là phiên bản tổng quát hơn, không chỉ kiểm soát trình duyệt mà toàn bộ giao diện desktop. Anthropic Claude Computer Use là ví dụ điển hình: đây là hệ thống duy nhất trong nhiều nghiên cứu kiểm soát toàn bộ desktop thay vì chỉ một cửa sổ trình duyệt [1].

### 2.4 Online Evaluation vs. Offline Evaluation

Một phân biệt then chốt trong nghiên cứu hiện đại là giữa **offline evaluation** (dùng snapshot website đã được cache) và **online evaluation** (chạy trực tiếp trên website thực). Các benchmark offline như Mind2Web hay WebLINX không thể phản ánh đúng năng lực thực của agent vì chúng giới hạn khả năng khám phá môi trường [1].

Ví dụ:
**Offline Evaluation** = Thi lý thuyết bằng ảnh chụp
In ra một đống ảnh chụp màn hình của đường phố, rồi hỏi: "Nếu thấy cảnh này, bạn sẽ làm gì?"
Người thi chỉ cần nhìn ảnh tĩnh và trả lời — không cần lái xe thật, không có xe cộ di chuyển, không có đèn tín hiệu thay đổi.
Đây là cách Mind2Web hoạt động: chụp lại website rồi đóng băng nó, sau đó cho agent "giả vờ" tương tác trên cái snapshot đó.

**Online Evaluation** = Thi thực hành trên đường thật
Người thi phải lái xe thật, trên đường thật, với đèn xanh đèn đỏ thay đổi liên tục, xe khác cắt ngang, biển hiệu có thể mờ...
Đây là cách Online-Mind2Web hoạt động: agent phải vào website thật, website thay đổi theo thời gian thực, nội dung hôm nay khác hôm qua.

### 2.5 LLM-as-a-Judge

**LLM-as-a-Judge** là phương pháp dùng một LLM khác làm "giám khảo" để tự động đánh giá kết quả của agent, thay cho human evaluation tốn kém. Tuy nhiên, các nghiên cứu cho thấy phương pháp này cần được thiết kế cẩn thận vì có thể dẫn đến kết quả sai lệch đáng kể [1].

### 2.6 Web World Model

**Web World Model** là một mô hình mô phỏng môi trường web — thay vì tương tác trực tiếp với website thực, agent được huấn luyện trong môi trường giả lập do world model tổng hợp. Đây là hướng tiếp cận mới để giải quyết các giới hạn về network latency, rate limit, và rủi ro an toàn khi thu thập dữ liệu thực [2].

### 2.7 ReAct Framework

Kiến trúc **ReAct** (Reasoning + Acting) là nền tảng cho nhiều browser agent hiện đại: agent xen kẽ bước suy luận (reasoning) và bước hành động (acting) theo vòng lặp lặp lại, cho phép tự sửa lỗi và thích nghi với kết quả thực tế của môi trường.

---

## 3. Xu Hướng Thế Giới

### 3.1 Sự Trỗi Dậy của Autonomous Web Agent

Quá trình số hóa và sự phát triển của công nghệ đám mây đã khiến web trở thành một trong những môi trường quan trọng nhất trong xã hội hiện đại. Các autonomous web agent dựa trên LLMs tiềm năng mạnh mẽ trong tự động hóa công việc [1]. Năm 2024–2025 chứng kiến sự ra mắt đồng loạt của nhiều hệ thống thương mại lớn:

- **OpenAI Operator** (2025): Web agent thương mại của OpenAI, đạt tỷ lệ thành công 61% trên benchmark Online-Mind2Web — mức cao nhất trong các hệ thống được đánh giá [1].
- **Anthropic Claude Computer Use** (2024–2025): Hệ thống kiểm soát desktop và browser, là một trong hai agent dẫn đầu trong các đánh giá độc lập [1].
- **OpenAI ChatGPT Atlas** (2025): Tích hợp LLM trực tiếp vào trình duyệt dưới dạng sidebar với Agent Mode có khả năng thực hiện các tác vụ tự động như lập lịch du lịch hay mua sắm [xem thêm: 9].
- **Perplexity Comet** (2025): Trình duyệt AI tự động hóa nghiên cứu và quản lý email trực tiếp từ giao diện [xem thêm: 9].

### 3.2 Phân Loại Hệ Thống Browser Agent

Hiện tại có ba kiến trúc chính:

**Vision-based agents:** Sử dụng screenshot để quan sát trạng thái giao diện, gửi hình ảnh cho model multimodal để ra quyết định. Cách tiếp cận này linh hoạt nhưng kém chính xác hơn với các phần tử nhỏ như calendar picker.

**DOM-based agents:** Phân tích cây DOM (Document Object Model) để lấy thông tin về các phần tử tương tác. Cách tiếp cận này chính xác hơn nhưng không xử lý được canvas HTML5 (như Google Sheets hay Figma).

**Hybrid agents:** Kết hợp cả DOM analysis và screenshot — đây là hướng được nhiều hệ thống hiện đại ưa chuộng, bao gồm cả Crab-Agent.

### 3.3 Benchmarks Tiêu Chuẩn

Lĩnh vực này sử dụng một số benchmark quan trọng để đánh giá:

- **WebArena / VisualWebArena:** Môi trường sandbox với website được mô phỏng — phù hợp cho phát triển nhanh nhưng hạn chế về đa dạng.
- **Mind2Web:** Dataset offline từ dữ liệu crowdsource đa dạng, nhưng 47% task bị lỗi thời hoặc không còn khả thi khi chạy online [1].
- **WebVoyager:** Benchmark online phổ biến nhất, nhưng có nhiều shortcoming nghiêm trọng được phát hiện trong nghiên cứu mới nhất [1].
- **Online-Mind2Web (2025):** Benchmark mới gồm 300 tasks đa dạng trải rộng trên 136 website thực, được thiết kế khắc phục các điểm yếu của WebVoyager [1].

---

## 4. Đánh Giá Năng Lực Thực Tế: "Ảo Tưởng Tiến Bộ"

### 4.1 Khoảng Cách Giữa Kết Quả Báo Cáo và Thực Tế

Nghiên cứu "An Illusion of Progress? Assessing the Current State of Web Agents" [1] đưa ra một phát hiện gây sốc: các kết quả được báo cáo trên benchmark WebVoyager (gần 90% success rate) hoàn toàn không phản ánh đúng năng lực thực tế của agent khi đối mặt với web thực.

Khi các agent tương tự được kiểm tra trên benchmark Online-Mind2Web — một môi trường phản ánh sát hơn cách người dùng thực sự sử dụng web — tỷ lệ thành công giảm mạnh đối với hầu hết hệ thống. Nhiều agent mới ra mắt sau năm 2024 thậm chí không vượt qua được SeeAct, một agent đơn giản ra mắt từ đầu năm 2024 [1].

### 4.2 Vì Sao WebVoyager Tạo Ra "Ảo Tưởng"?

Nghiên cứu [1] chỉ ra ba điểm yếu cốt lõi của WebVoyager:

**Thiếu độ bao phủ và đa dạng:** Benchmark chỉ gồm 15 website với task được tổng hợp bằng cách cho LLM biến đổi các task từ Mind2Web — dẫn đến task đơn giản, thiếu thực tế.

**Shortcut solutions:** Một "search agent" đơn giản — chỉ thực hiện hai bước: (1) tạo truy vấn Google Search, (2) nhấp vào kết quả trả về — đã có thể giải quyết 51% số task trong WebVoyager mà không cần tương tác thực sự với website [1]. Con số này giảm xuống chỉ còn 22% khi chạy trên Online-Mind2Web.

**Đánh giá tự động sai lệch:** LLM-as-a-Judge trong WebVoyager đồng thuận thấp với human judgment, dẫn đến kết quả đánh giá tự động bị thổi phồng.

### 4.3 Online-Mind2Web: Benchmark Chuẩn Mới

Nhóm nghiên cứu đề xuất Online-Mind2Web với các cải tiến [1]:

- **300 tasks** từ dữ liệu crowdsource thực (không tổng hợp bằng LLM), trải rộng trên 136 website.
- **Ba mức độ khó** dựa trên số bước thực hiện: Easy (Nstep ≤ 5), Medium (6 ≤ Nstep ≤ 10), Hard (Nstep ≥ 11).
- Loại bỏ các task mơ hồ, không còn khả thi, hoặc bị chặn bởi CAPTCHA.

### 4.4 WebJudge: LLM-as-a-Judge Thế Hệ Mới

Để giải quyết vấn đề đánh giá, nghiên cứu [1] giới thiệu **WebJudge** — phương pháp đánh giá tự động mới với quy trình ba bước:

1. **Key Point Identification:** LLM xác định các điểm then chốt cần hoàn thành để task được coi là thành công.
2. **Key Screenshot Identification:** Từ chuỗi screenshot, chọn các frame quan trọng chứa bằng chứng thực sự.
3. **Outcome Judgement:** Đưa ra phán quyết dựa trên task description, key points, key screenshots, và action history.

WebJudge đạt ~85% đồng thuận với human judgment, cao hơn đáng kể so với các phương pháp hiện tại [1].

---

## 5. WebWorld: Huấn Luyện Agent Ở Quy Mô Lớn

### 5.1 Vấn Đề Cốt Lõi

Các web agent cần lượng lớn trajectory dữ liệu để tổng quát hóa, nhưng việc thu thập trực tiếp từ web thực bị hạn chế bởi network latency, rate limits, và rủi ro an toàn khi thực hiện các hành động không thể hoàn tác [2].

### 5.2 Giải Pháp: Open-Web Simulator

**WebWorld** [2] — được giới thiệu là web simulator quy mô lớn đầu tiên trên open web — giải quyết vấn đề này bằng cách:

- Huấn luyện world model trên hơn **1 triệu tương tác web thực** (thay vì hàng chục nghìn như các hệ thống trước).
- Hỗ trợ **long-horizon simulation** với chuỗi hành động dài hơn 30 bước.
- Cho phép agent tổng hợp trajectory giả lập để huấn luyện — mô hình Qwen3-14B được huấn luyện trên WebWorld-synthesized trajectories cải thiện +9.2% trên WebArena [2].

### 5.3 Ý Nghĩa Đối Với Browser Agent

WebWorld chứng minh rằng training trên dữ liệu mô phỏng quy mô lớn từ open web có thể tạo ra agent có khả năng tổng quát tốt hơn đáng kể so với các phương pháp huấn luyện trong môi trường đóng. Đây là hướng đi quan trọng để nâng cao năng lực của các browser agent như Crab-Agent trong tương lai.

---

## 6. Ứng Dụng Thực Tế của Browser Use

### 6.1 Tự Động Hóa Công Việc Văn Phòng

Browser agent có thể tự động thực hiện các tác vụ lặp lại như: điền form, thu thập dữ liệu từ nhiều website, tổng hợp thông tin, đặt lịch hẹn, và gửi email. Đây là ứng dụng tạo ra ROI trực tiếp và dễ đo lường nhất.

### 6.2 Research Automation

Agent có thể tự chủ tìm kiếm thông tin từ nhiều nguồn, tổng hợp kết quả, và trả lời câu hỏi phức tạp — thay thế hàng giờ nghiên cứu thủ công. WebVoyager được thiết kế ban đầu cho loại ứng dụng này.

### 6.3 E-Commerce và Mua Sắm

Agent có thể so sánh giá, theo dõi sản phẩm, và thực hiện mua sắm tự động — trên nhiều platform khác nhau cùng lúc. Đây là usecase được OpenAI Operator tập trung phát triển.

### 6.4 Software Testing và QA

Web agent có thể tự động chạy test case trên giao diện web thực, phát hiện lỗi UI/UX, và báo cáo kết quả — thay thế một phần công việc của QA engineer.

### 6.5 Tiếp Cận Thông Tin Cho Người Dùng Đặc Biệt

Với người dùng khuyết tật, web agent có thể hoạt động như một lớp điều phối giúp họ tương tác với web thông qua ngôn ngữ tự nhiên mà không cần thao tác thủ công phức tạp.

### 6.6 Data Extraction và ETL

Browser agent có thể trích xuất dữ liệu có cấu trúc từ website, xử lý và đưa vào pipeline phân tích — mạnh hơn web scraper truyền thống vì có khả năng xử lý dynamic content và đăng nhập xác thực.

---

## 7. Thách Thức và Hướng Phát Triển

### 7.1 Giới Hạn Kỹ Thuật Hiện Tại

**Hallucination trong action execution:** Agent có thể "tưởng tượng" đã hoàn thành một bước mà thực tế chưa thực hiện, hoặc báo cáo thành công khi thất bại — một vấn đề được ghi nhận rõ ràng trong [1].

**Xử lý ràng buộc số và thời gian:** Ngay cả Operator — agent dẫn đầu trong nghiên cứu [1] — vẫn thất bại với các task đòi hỏi xử lý chính xác ngày giờ hoặc ràng buộc số học.

**Canvas và non-DOM content:** Agent gặp khó khăn với các ứng dụng web phức tạp (Figma, Google Sheets) không expose phần tử tương tác qua DOM.

**Long-horizon tasks:** Chuỗi hành động dài dễ tích lũy lỗi — một task khó (Hard, Nstep ≥ 11) có thể thất bại chỉ vì một bước lỗi ở giữa.

### 7.2 Hướng Nghiên Cứu hiện tại trên thế giới

Dựa trên phân tích các tài liệu, các hướng nghiên cứu quan trọng bao gồm:

**Web World Models:** Như WebWorld [2] đề xuất, huấn luyện simulator trên open web quy mô 1M+ interaction có thể tạo ra agent tổng quát hơn đáng kể, giảm phụ thuộc vào dữ liệu thực.

**Better evaluation methodology:** WebJudge [1] là bước đi quan trọng nhưng vẫn còn 15% sai lệch so với human judgment. Cần thêm công việc để làm cho automatic evaluation tin cậy hơn.

**User experience design:** Nghiên cứu về UX cho computer use agent nhấn mạnh rằng explainability, user control, và mental model của người dùng là các dimension quan trọng cần được thiết kế kỹ — không chỉ tập trung vào model performance.

**Security và Privacy:** Browser agent có quyền truy cập rộng vào session của người dùng. Nghiên cứu về browser agent privacy đã phát hiện các lỗ hổng trong cách các agent xử lý mixed content và cross-origin requests.

---

## 8. Kết Luận

Browser Use / Web Agent đang ở giai đoạn chuyển tiếp quan trọng: từ nghiên cứu proof-of-concept sang ứng dụng thực tiễn, nhưng còn một khoảng cách đáng kể giữa kết quả được báo cáo và năng lực thực sự. Nghiên cứu của Xue et al. [1] đã chứng minh rằng thậm chí agent dẫn đầu thị trường như Operator chỉ đạt 61% success rate trong điều kiện thực tế.

Điều này không có nghĩa là công nghệ không có giá trị — ngược lại, nó chỉ ra rằng community cần:
1. Benchmark thực tế hơn (như Online-Mind2Web [1])
2. Phương pháp đánh giá tin cậy hơn (như WebJudge [1])
3. Dữ liệu huấn luyện quy mô lớn hơn (như WebWorld [2])
4. Tập trung vào các điểm yếu cụ thể thay vì tối ưu benchmark

Với dự án **Crab-Agent**, việc xây dựng một browser agent mã nguồn mở, hybrid (DOM + Vision), multi-provider ngay từ bây giờ là một bước đi phù hợp với xu hướng nghiên cứu: khám phá năng lực và giới hạn thực tế của browser agent trên môi trường web đa dạng, đồng thời cung cấp một nền tảng thực nghiệm có thể mở rộng theo sự phát triển của field.

---

## 9. Tài Liệu Tham Khảo

[1] Xue, T., Qi, W., Shi, T., Song, C. H., Gou, B., Song, D., Sun, H., & Su, Y. (2025). **An Illusion of Progress? Assessing the Current State of Web Agents.** *COLM 2025.* arXiv:2504.01382. https://arxiv.org/abs/2504.01382

[2] Xiao, Z., Tu, J., Zou, C., Zuo, Y., Li, Z., Wang, P., Yu, B., Huang, F., Lin, J., & Liu, Z. (2026). **WebWorld: A Large-Scale World Model for Web Agent Training.** arXiv:2602.14721. https://arxiv.org/abs/2602.14721

[3] Hert4. (2025–2026). **Crab-Agent: A Wild Browser Agent Extension.** GitHub. https://github.com/Hert4/crab-agent

[4] Deng, X., Gu, Y., Zheng, B., Chen, S., Stevens, S., Wang, B., Sun, H., & Su, Y. (2023). **Mind2Web: Towards a Generalist Agent for the Web.** NeurIPS 2023.

[5] He, H., Yao, W., Ma, K., Yu, W., Dai, Y., Zhang, H., Lan, Z., & Yu, D. (2024). **WebVoyager: Building an End-to-End Web Agent with Large Multimodal Models.** ACL 2024.

[6] Zhou, S., Xu, F. F., Zhu, H., Zhou, X., Lo, R., Sridhar, A., Cheng, X., Bisk, Y., Fried, D., Alon, U., & Neubig, G. (2024). **WebArena: A Realistic Web Environment for Building Autonomous Agents.** ICLR 2024.

[7] Staufer, L., et al. (2026). **The 2025 AI Agent Index: Documenting Technical and Safety Features of Deployed Agentic AI Systems.** arXiv:2602.17753.

[8] Zheng, L., et al. (2024). **GPT-4V(ision) is a Generalist Web Agent, if Grounded (SeeAct).** ICML 2024.

[9] (2025). **Building Browser Agents: Architecture, Security, and Practical Solutions.** arXiv:2511.19477.


## IMPORTAMT NOTES:
*Phân tích chủ yếu được trích xuất từ paper gốc*