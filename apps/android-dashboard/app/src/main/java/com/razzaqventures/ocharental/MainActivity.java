package com.razzaqventures.ocharental;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Typeface;
import android.view.View;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private EditText baseUrl, apiKey, memberLimit, targetJid, commandList;
    private Spinner membershipAction, commandMode;
    private TextView status, overview, actionHistory;
    private Button connect;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        buildUi();
    }

    private int dp(float value) { return (int) (value * getResources().getDisplayMetrics().density + 0.5f); }
    private TextView text(String value, int size, boolean bold) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(0xff18243a);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setPadding(0, dp(5), 0, dp(5)); return view;
    }
    private EditText input(String hint, boolean secret) {
        EditText field = new EditText(this); field.setSingleLine(!hint.toLowerCase().contains("catatan")); field.setHint(hint); field.setTextSize(14);
        if (secret) field.setInputType(129);
        field.setPadding(dp(12), dp(8), dp(12), dp(8)); return field;
    }
    private Button button(String label, Runnable action) {
        Button button = new Button(this); button.setText(label); button.setOnClickListener(v -> action.run()); return button;
    }
    private LinearLayout panel(LinearLayout parent, String title) {
        LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(dp(16), dp(14), dp(16), dp(14));
        box.setBackgroundColor(0xffffffff); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.setMargins(0, dp(7), 0, dp(7)); parent.addView(box, params);
        box.addView(text(title, 17, true)); return box;
    }
    private void buildUi() {
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(0xfff1f4f8);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(16), dp(18), dp(16), dp(26)); scroll.addView(root);
        setContentView(scroll);
        root.addView(text("OCHA LIDYA", 12, true)); root.addView(text("Rental Dashboard", 28, true));
        root.addView(text("Panel privat untuk pemilik sewa. API key tidak disimpan oleh aplikasi.", 13, false));

        LinearLayout connection = panel(root, "Koneksi API");
        baseUrl = input("Shared gateway URL · https://...trycloudflare.com", false); connection.addView(baseUrl);
        apiKey = input("ocha_live_ API key", true); connection.addView(apiKey);
        connect = button("Hubungkan dan Muat Data", this::refresh); connection.addView(connect);
        status = text("Belum terhubung.", 12, false); connection.addView(status);

        LinearLayout summary = panel(root, "Ringkasan Sewa");
        overview = text("Hubungkan API untuk melihat informasi paket, anggota, kuota, dan masa aktif.", 14, false); summary.addView(overview);

        LinearLayout limits = panel(root, "Batas Anggota");
        memberLimit = input("Batas anggota baru (maksimum sesuai paket)", false); memberLimit.setInputType(2); limits.addView(memberLimit);
        limits.addView(button("Simpan Batas Anggota", this::saveLimit));
        limits.addView(text("Limit tidak dapat melewati kapasitas paket atau lebih rendah dari jumlah anggota saat ini.", 12, false));

        LinearLayout members = panel(root, "Pengelolaan Anggota");
        membershipAction = new Spinner(this); membershipAction.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[]{"remove", "promote", "demote"})); members.addView(membershipAction);
        targetJid = input("Nomor anggota: 62812xxxx@s.whatsapp.net", false); members.addView(targetJid);
        members.addView(button("Kirim Aksi ke Antrean Bot", this::sendMembershipAction));
        members.addView(text("Aksi diproses bot setelah memeriksa sewa aktif, status admin bot, target, dan keamanan grup.", 12, false));

        LinearLayout commands = panel(root, "Akses Perintah");
        commandMode = new Spinner(this); commandMode.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[]{"denylist", "allowlist"})); commands.addView(commandMode);
        commandList = input("Nama command dipisahkan koma, contoh: sticker, tiktok, ai", false); commands.addView(commandList);
        commands.addView(button("Simpan Kebijakan Command", this::saveCommands));
        commands.addView(text("Mode denylist menonaktifkan command yang ditulis. Mode allowlist hanya mengizinkan command yang ditulis. Command sistem seperti menu, sewa, dan gadmin selalu tersedia.", 12, false));

        LinearLayout history = panel(root, "Riwayat Aksi Anggota");
        actionHistory = text("Belum ada data.", 13, false); history.addView(actionHistory);
        history.addView(button("Muat Riwayat", this::loadHistory));

        LinearLayout guide = panel(root, "Panduan Singkat");
        guide.addView(text("1. Di WhatsApp, ketik .sewaapi buat rental dan simpan API key secara privat.\n2. Ketik .sewaapi gateway untuk mendapatkan alamat gateway publik.\n3. Masukkan URL gateway dan API key di atas.\n4. Jangan bagikan API key kepada admin lain atau menaruhnya di source code.\n5. URL TryCloudflare sementara dapat berubah setelah bot restart; minta URL gateway terbaru dari bot.\n6. Jika bot bukan admin grup, aksi promote/demote/remove akan gagal dan dicatat.", 13, false));
        root.addView(text("Razzaq Ventures · Ocha Lidya", 11, false));
    }

    private String getBase() throws Exception {
        String value = baseUrl.getText().toString().trim().replaceAll("/+$", "");
        if (!value.startsWith("https://") || value.contains(" ")) throw new Exception("Gunakan URL gateway HTTPS yang valid.");
        return value;
    }
    private String getKey() throws Exception {
        String value = apiKey.getText().toString().trim();
        if (!value.startsWith("ocha_live_") || value.length() < 40) throw new Exception("API key tidak valid.");
        return value;
    }
    private JSONObject request(String method, String route, JSONObject payload, boolean idempotent) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(getBase() + route).openConnection();
        connection.setRequestMethod(method); connection.setConnectTimeout(12000); connection.setReadTimeout(18000);
        connection.setRequestProperty("Accept", "application/json"); connection.setRequestProperty("x-api-key", getKey());
        if (payload != null) {
            connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            if (idempotent) connection.setRequestProperty("Idempotency-Key", UUID.randomUUID().toString());
            try (OutputStream output = connection.getOutputStream()) { output.write(payload.toString().getBytes(StandardCharsets.UTF_8)); }
        }
        int code = connection.getResponseCode(); InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
        if (stream == null) { connection.disconnect(); throw new Exception("Server tidak memberikan response body (HTTP " + code + ")."); }
        StringBuilder response = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) { String line; while ((line = reader.readLine()) != null) response.append(line); }
        connection.disconnect(); JSONObject json = new JSONObject(response.toString());
        if (code < 200 || code >= 300) throw new Exception(json.optString("message", json.optString("error", "API error " + code)));
        return json;
    }
    private void run(String label, java.util.concurrent.Callable<String> work) {
        status.setText(label + "..."); connect.setEnabled(false);
        worker.execute(() -> {
            try { String result = work.call(); runOnUiThread(() -> { status.setText(result); connect.setEnabled(true); }); }
            catch (Exception error) { runOnUiThread(() -> { status.setText("Gagal: " + error.getMessage()); connect.setEnabled(true); Toast.makeText(this, error.getMessage(), Toast.LENGTH_LONG).show(); }); }
        });
    }
    private void refresh() {
        run("Memuat data", () -> {
            JSONObject result = request("GET", "/api/v1/rental/overview", null, false).getJSONObject("data");
            JSONObject group = result.getJSONObject("group"), sub = result.getJSONObject("subscription"), quota = result.optJSONObject("quota");
            String summary = "Grup: " + group.optString("name") + "\nAnggota: " + group.optInt("member_count") + " / " + group.optInt("member_limit") + "\nPaket: " + sub.optString("plan") + "\nStatus: " + sub.optString("status") + "\nAktif sampai: " + sub.optString("expires_at") + "\nKuota: " + (quota == null ? "-" : quota.optInt("used") + " / " + quota.optInt("limit") + " · sisa " + quota.optInt("remaining"));
            runOnUiThread(() -> { overview.setText(summary); memberLimit.setText(String.valueOf(group.optInt("member_limit"))); });
            return "Dashboard tersambung.";
        });
    }
    private void saveLimit() {
        run("Memperbarui limit", () -> {
            JSONObject body = new JSONObject(); body.put("member_limit", Integer.parseInt(memberLimit.getText().toString().trim()));
            JSONObject data = request("PATCH", "/api/v1/rental/member-limit", body, true).getJSONObject("data");
            return "Limit tersimpan: " + data.optInt("member_limit") + " anggota.";
        });
    }
    private void sendMembershipAction() {
        run("Mengirim aksi anggota", () -> {
            JSONObject body = new JSONObject(); body.put("action", String.valueOf(membershipAction.getSelectedItem())); body.put("target_jid", targetJid.getText().toString().trim());
            JSONObject data = request("POST", "/api/v1/rental/membership/actions", body, true).getJSONObject("data");
            return "Aksi " + data.optString("action") + " masuk antrean: " + data.optString("action_id");
        });
    }
    private void saveCommands() {
        run("Menyimpan akses command", () -> {
            String[] names = commandList.getText().toString().toLowerCase().split(","); JSONArray commands = new JSONArray();
            for (String name : names) if (!name.trim().isEmpty()) commands.put(name.trim());
            JSONObject body = new JSONObject(); body.put("mode", String.valueOf(commandMode.getSelectedItem())); body.put("commands", commands);
            JSONObject data = request("PATCH", "/api/v1/rental/commands", body, true).getJSONObject("data");
            return "Kebijakan tersimpan: " + data.optString("mode") + " · " + data.optJSONArray("commands").length() + " command.";
        });
    }
    private void loadHistory() {
        run("Memuat riwayat", () -> {
            JSONArray items = request("GET", "/api/v1/rental/membership/actions", null, false).getJSONArray("data");
            StringBuilder output = new StringBuilder();
            for (int i = 0; i < items.length(); i++) { JSONObject item = items.getJSONObject(i); output.append(item.optString("action")).append(" · ").append(item.optString("target_jid")).append("\nStatus: ").append(item.optString("status")).append("\n"); if (!item.optString("error").isEmpty()) output.append("Keterangan: ").append(item.optString("error")).append("\n"); output.append("\n"); }
            String value = output.length() == 0 ? "Belum ada aksi." : output.toString(); runOnUiThread(() -> actionHistory.setText(value));
            return "Riwayat diperbarui: " + items.length() + " item.";
        });
    }
    @Override protected void onDestroy() { if (apiKey != null) apiKey.getText().clear(); worker.shutdownNow(); super.onDestroy(); }
}
